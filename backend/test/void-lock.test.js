/**
 * Once a document is voided (by the sender, or because a signer declined) or
 * deleted, its signing links must stop working. Before this, every signing
 * action only refused a signer who had already signed, so a co-signer could
 * still complete a voided document: their signature was embedded over the
 * VOID copy and the document could be marked completed.
 */
const fs = require('fs');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../src/services/pdfSign.service', () => ({
  embedSignatureInPdf: jest.fn(async () => ({ key: 'signed.pdf', buffer: Buffer.from('%PDF-1.4 signed') })),
  applyVoidWatermark: jest.fn(async () => 'voided.pdf'),
}));
const pdf = require('../src/services/pdfSign.service');

const { buildApp } = require('./app');
const { uploadDir } = require('../src/config/env');
const User = require('../src/models/User');
const Document = require('../src/models/Document');
const SignRequest = require('../src/models/SignRequest');
const { signingClosedReason } = require('../src/services/signing.service');

let mongod;
let app;
let doc;

const SIG = 'data:image/png;base64,iVBORw0KGgo=';
const field = { id: 'f1', page: 1, x: 10, y: 10, width: 100, height: 30, type: 'signature' };

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
  jest.clearAllMocks();
  await Promise.all([User.deleteMany({}), Document.deleteMany({}), SignRequest.deleteMany({})]);
  const owner = await User.create({ email: 'agent@example.com', passwordHash: 'x', name: 'Agent', roles: ['user'] });
  doc = await Document.create({ ownerId: owner._id, title: 'Authority', status: 'pending' });
  await SignRequest.create([
    { documentId: doc._id, signerEmail: 'vendor.a@example.com', signerName: 'Vendor A', signLinkToken: 'tok-a',
      order: 1, signatureFields: [field] },
    { documentId: doc._id, signerEmail: 'vendor.b@example.com', signerName: 'Vendor B', signLinkToken: 'tok-b',
      order: 2, signatureFields: [field], fieldSignatureData: { f1: SIG } },
  ]);
});

const voidIt = () => Document.updateOne({ _id: doc._id }, { status: 'voided', signedKey: 'voided.pdf' });

describe('a voided document', () => {
  beforeEach(voidIt);

  it.each([
    ['sign', (t) => request(app).post(`/signing/${t}/sign`).send({ signatureData: SIG, fieldId: 'f1' })],
    ['field-value', (t) => request(app).patch(`/signing/${t}/field-value`).send({ fieldId: 'f2', value: 'x' })],
    ['approve', (t) => request(app).post(`/signing/${t}/approve`)],
    ['complete', (t) => request(app).post(`/signing/${t}/complete`)],
  ])('refuses %s', async (_name, call) => {
    const res = await call('tok-b');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DOCUMENT_VOIDED');
  });

  it('keeps the VOID copy and its status when a signer tries to complete', async () => {
    await request(app).post('/signing/tok-b/complete');
    const after = await Document.findById(doc._id).lean();
    expect(after.status).toBe('voided');
    expect(after.signedKey).toBe('voided.pdf');
    expect(pdf.embedSignatureInPdf).not.toHaveBeenCalled();
    expect((await SignRequest.findOne({ signLinkToken: 'tok-b' }).lean()).status).not.toBe('signed');
  });

  it('records nothing the signer sends', async () => {
    await request(app).patch('/signing/tok-a/field-value').send({ fieldId: 'f2', value: 'late' });
    await request(app).post('/signing/tok-a/sign').send({ signatureData: SIG, fieldId: 'f1' });
    const a = await SignRequest.findOne({ signLinkToken: 'tok-a' }).lean();
    expect(a.fieldValues).toBeUndefined();
    expect(a.fieldSignatureData).toBeUndefined();
  });
});

it('refuses every signing action on a deleted document', async () => {
  await Document.updateOne({ _id: doc._id }, { status: 'deleted' });
  const res = await request(app).post('/signing/tok-b/complete');
  expect(res.status).toBe(404);
  expect(pdf.embedSignatureInPdf).not.toHaveBeenCalled();
});

it('does not overwrite a void that lands while the signed copy is being built', async () => {
  await SignRequest.deleteOne({ signLinkToken: 'tok-a' });
  pdf.embedSignatureInPdf.mockImplementationOnce(async () => {
    await voidIt();
    return { key: 'signed.pdf', buffer: Buffer.from('%PDF') };
  });
  const res = await request(app).post('/signing/tok-b/complete');
  expect(res.status).toBe(409);
  const after = await Document.findById(doc._id).lean();
  expect(after.status).toBe('voided');
  expect(after.signedKey).toBe('voided.pdf');
  expect((await SignRequest.findOne({ signLinkToken: 'tok-b' }).lean()).status).not.toBe('signed');
});

it('turns a signer away once they have declined', () => {
  expect(signingClosedReason({ status: 'pending' }, { status: 'declined' }).code).toBe('SIGNER_DECLINED');
  expect(signingClosedReason({ status: 'pending' }, { status: 'pending' })).toBeNull();
});

it('still lets the last signer complete an open document', async () => {
  await SignRequest.updateOne({ signLinkToken: 'tok-a' }, { status: 'signed', signedAt: new Date() });
  const res = await request(app).post('/signing/tok-b/complete');
  expect(res.status).toBe(200);
  const after = await Document.findById(doc._id).lean();
  expect(after.status).toBe('completed');
  expect(after.signedFilePath || after.signedKey).toBe('signed.pdf');
});
