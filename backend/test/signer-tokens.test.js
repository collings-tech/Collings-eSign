/**
 * A signing link token lets whoever holds it open, fill in and complete that
 * signer's part of a document without signing in. So the APIs that list a
 * document's signers must only ever return a caller's own link: a co-signer
 * (or the sender) who could read another signer's token could sign as them.
 */
const fs = require('fs');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { buildApp } = require('./app');
const { uploadDir } = require('../src/config/env');
const User = require('../src/models/User');
const Document = require('../src/models/Document');
const SignRequest = require('../src/models/SignRequest');
const { signToken } = require('../src/middleware/auth');

let mongod;
let app;
let owner, vendorA, vendorB, stranger, doc;

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
  await Promise.all([User.deleteMany({}), Document.deleteMany({}), SignRequest.deleteMany({})]);
  owner = await User.create({ email: 'agent@example.com', passwordHash: 'x', name: 'Agent', roles: ['user'] });
  vendorA = await User.create({ email: 'vendor.a@example.com', passwordHash: 'x', name: 'Vendor A', roles: ['user'] });
  vendorB = await User.create({ email: 'vendor.b@example.com', passwordHash: 'x', name: 'Vendor B', roles: ['user'] });
  stranger = await User.create({ email: 'stranger@example.com', passwordHash: 'x', name: 'Stranger', roles: ['user'] });
  doc = await Document.create({ ownerId: owner._id, title: 'Authority', status: 'pending' });
  await SignRequest.create([
    { documentId: doc._id, signerEmail: vendorA.email, signerName: 'Vendor A', signLinkToken: 'tok-vendor-a', order: 1,
      status: 'signed', signerIp: '203.0.113.7', userAgent: 'Safari' },
    { documentId: doc._id, signerEmail: vendorB.email, signerName: 'Vendor B', signLinkToken: 'tok-vendor-b', order: 2 },
  ]);
});

const bearer = (u) => ({ Authorization: `Bearer ${signToken(u)}` });
const byEmail = (rows) => Object.fromEntries(rows.map((r) => [r.signerEmail, r]));

describe('GET /sign-requests/:documentId', () => {
  it("gives a signer their own link but not their co-signer's", async () => {
    const res = await request(app).get(`/sign-requests/${doc._id}`).set(bearer(vendorB));
    expect(res.status).toBe(200);
    const rows = byEmail(res.body);
    expect(rows[vendorB.email].signLinkToken).toBe('tok-vendor-b');
    expect(rows[vendorA.email]).toBeDefined();
    expect(rows[vendorA.email].signLinkToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('tok-vendor-a');
  });

  it("hides a co-signer's IP address and device from another signer", async () => {
    const res = await request(app).get(`/sign-requests/${doc._id}`).set(bearer(vendorB));
    const a = byEmail(res.body)[vendorA.email];
    expect(a.status).toBe('signed');
    expect(a.signerIp).toBeUndefined();
    expect(a.userAgent).toBeUndefined();
  });

  it("gives the sender every signer's status, IP and device but none of their links", async () => {
    const res = await request(app).get(`/sign-requests/${doc._id}`).set(bearer(owner));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const a = byEmail(res.body)[vendorA.email];
    expect(a.signerIp).toBe('203.0.113.7');
    expect(a.userAgent).toBe('Safari');
    res.body.forEach((row) => expect(row.signLinkToken).toBeUndefined());
  });

  it('gives the sender their own link when they are also a signer', async () => {
    await SignRequest.create({ documentId: doc._id, signerEmail: owner.email, signerName: 'Agent', signLinkToken: 'tok-agent', order: 3 });
    const res = await request(app).get(`/sign-requests/${doc._id}`).set(bearer(owner));
    const rows = byEmail(res.body);
    expect(rows[owner.email].signLinkToken).toBe('tok-agent');
    expect(rows[vendorA.email].signLinkToken).toBeUndefined();
    expect(rows[vendorB.email].signLinkToken).toBeUndefined();
  });

  it('still hides the document from anyone who is neither sender nor signer', async () => {
    const res = await request(app).get(`/sign-requests/${doc._id}`).set(bearer(stranger));
    expect(res.status).toBe(404);
  });
});

describe('GET /documents/agreements', () => {
  it("gives a signer their own link but not their co-signer's", async () => {
    const res = await request(app).get('/documents/agreements').set(bearer(vendorB));
    expect(res.status).toBe(200);
    const agreement = res.body.find((d) => d._id === doc._id.toString());
    expect(agreement.mySignRequest.signLinkToken).toBe('tok-vendor-b');
    const rows = byEmail(agreement.signRequests);
    expect(rows[vendorA.email].signLinkToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('tok-vendor-a');
  });

  it("gives the sender the signers' status but none of their links", async () => {
    const res = await request(app).get('/documents/agreements').set(bearer(owner));
    const agreement = res.body.find((d) => d._id === doc._id.toString());
    expect(agreement.signRequests.map((r) => r.status).sort()).toEqual(['pending', 'signed']);
    expect(JSON.stringify(res.body)).not.toMatch(/tok-vendor-[ab]/);
  });
});
