/**
 * Locks in the access-control fixes from the October 2026 repo review:
 *   - audit logs require a signed-in owner or signer
 *   - document files on local disk are not publicly served
 *   - signed local file URLs expire and cannot be tampered with
 *   - uploads are size-capped
 *   - no hard-coded JWT fallback
 */
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { buildApp } = require('./app');
const { uploadDir } = require('../src/config/env');
const User = require('../src/models/User');
const Document = require('../src/models/Document');
const SignRequest = require('../src/models/SignRequest');
const AuditLog = require('../src/models/AuditLog');
const { signToken } = require('../src/middleware/auth');
const { createFileToken, verifyFileToken } = require('../src/services/fileToken.service');

let mongod;
let app;
let owner, signer, stranger, doc;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildApp();
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Document.deleteMany({}), SignRequest.deleteMany({}), AuditLog.deleteMany({})]);
  owner = await User.create({ email: 'owner@example.com', passwordHash: 'x', name: 'Owner', roles: ['user'] });
  signer = await User.create({ email: 'signer@example.com', passwordHash: 'x', name: 'Signer', roles: ['user'] });
  stranger = await User.create({ email: 'stranger@example.com', passwordHash: 'x', name: 'Stranger', roles: ['user'] });
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, 'doc1.pdf'), '%PDF-1.4 test');
  doc = await Document.create({ ownerId: owner._id, title: 'Authority', originalFilePath: 'doc1.pdf', status: 'pending' });
  await SignRequest.create({
    documentId: doc._id, signerEmail: signer.email, signerName: 'Signer', signLinkToken: 'tok-signer-1',
  });
  await AuditLog.create({ documentId: doc._id, actorType: 'sender', actorIdOrEmail: owner.email, eventType: 'document_created' });
});

const bearer = (u) => ({ Authorization: `Bearer ${signToken(u)}` });

describe('GET /signing/document/:id/audit-logs', () => {
  it('rejects anonymous callers', async () => {
    const res = await request(app).get(`/signing/document/${doc._id}/audit-logs`);
    expect(res.status).toBe(401);
  });

  it('lets the owner read the trail', async () => {
    const res = await request(app).get(`/signing/document/${doc._id}/audit-logs`).set(bearer(owner));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].eventType).toBe('document_created');
  });

  it('lets a signer on the document read the trail', async () => {
    const res = await request(app).get(`/signing/document/${doc._id}/audit-logs`).set(bearer(signer));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('hides it from any other signed-in user (404, not 403, so ids are not confirmed)', async () => {
    const res = await request(app).get(`/signing/document/${doc._id}/audit-logs`).set(bearer(stranger));
    expect(res.status).toBe(404);
  });

  it('404s on a malformed id instead of 500', async () => {
    const res = await request(app).get('/signing/document/not-an-id/audit-logs').set(bearer(owner));
    expect(res.status).toBe(404);
  });
});

describe('local document files', () => {
  it('are no longer served from /uploads', async () => {
    const res = await request(app).get('/uploads/doc1.pdf');
    expect(res.status).toBe(404);
  });

  it('profile photos still are', async () => {
    fs.mkdirSync(path.join(uploadDir, 'profiles'), { recursive: true });
    fs.writeFileSync(path.join(uploadDir, 'profiles', 'a.png'), 'png');
    const res = await request(app).get('/uploads/profiles/a.png');
    expect(res.status).toBe(200);
  });

  it('are served through a signed /files URL that the owner gets from /file-url', async () => {
    const urlRes = await request(app).get(`/documents/${doc._id}/file-url`).set(bearer(owner));
    expect(urlRes.status).toBe(200);
    expect(urlRes.body.url).toMatch(/\/files\//);
    expect(urlRes.body.url).not.toMatch(/\/uploads\//);
    const token = urlRes.body.url.split('/files/')[1];
    const fileRes = await request(app).get(`/files/${token}`);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers['content-type']).toMatch(/application\/pdf/);
    expect(Buffer.from(fileRes.body).toString()).toContain('%PDF');
  });

  it('a signing token also yields a signed /files URL', async () => {
    const urlRes = await request(app).get('/signing/tok-signer-1/file-url');
    expect(urlRes.status).toBe(200);
    expect(urlRes.body.url).toMatch(/\/files\//);
  });

  it('refuses a tampered or expired token', async () => {
    const good = createFileToken('doc1.pdf', 60);
    const [p, exp, sig] = good.split('.');
    expect((await request(app).get(`/files/${p}.${exp}.${sig.slice(0, -2)}xx`)).status).toBe(403);
    const expired = createFileToken('doc1.pdf', 1).replace(`.${Math.floor(Date.now() / 1000) + 1}.`, `.${Math.floor(Date.now() / 1000) - 10}.`);
    expect(verifyFileToken(expired)).toBeNull(); // signature no longer matches the edited expiry
    expect((await request(app).get(`/files/${expired}`)).status).toBe(403);
  });

  it('cannot escape the upload directory', () => {
    expect(() => createFileToken('../.env')).toThrow();
    expect(() => createFileToken('/etc/passwd')).toThrow();
  });
});

describe('POST /documents upload limits', () => {
  it('returns 413 for a PDF over the cap', async () => {
    const { maxUploadBytes } = require('../src/config/env');
    const big = Buffer.alloc(maxUploadBytes + 1024, 0x20);
    const res = await request(app)
      .post('/documents')
      .set(bearer(owner))
      .field('title', 'Big')
      .attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(413);
  });

  it('returns 400, not 500, for a non-PDF', async () => {
    const res = await request(app)
      .post('/documents')
      .set(bearer(owner))
      .field('title', 'Nope')
      .attach('file', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });
});

describe('JWT secret', () => {
  const load = (env) => {
    jest.resetModules();
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      return require('../src/config/env');
    } finally {
      process.env = saved;
    }
  };

  it('refuses to start in production without one', () => {
    expect(() => load({ NODE_ENV: 'production', JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
  });

  it('refuses the old placeholder value', () => {
    expect(() => load({ NODE_ENV: 'production', JWT_SECRET: 'dev_secret_change_me' })).toThrow(/placeholder/);
  });

  it('never falls back to a fixed string outside production', () => {
    const a = load({ NODE_ENV: 'development', JWT_SECRET: '' }).jwtSecret;
    const b = load({ NODE_ENV: 'development', JWT_SECRET: '' }).jwtSecret;
    expect(a).not.toBe('dev_secret_change_me');
    expect(a).not.toBe(b);
  });
});
