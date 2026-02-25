const express = require('express');
const SignRequest = require('../models/SignRequest');
const Document = require('../models/Document');
const { saveSignatureOnly, saveFieldValue, completeSigning } = require('../services/signing.service');
const AuditLog = require('../models/AuditLog');
const { logEvent } = require('../services/audit.service');
const storageService = require('../services/storage.service');

const router = express.Router();

async function getDocumentViewUrl(doc, baseUrl, expiresInSeconds) {
  // Always prefer signed over original so after Complete the viewer gets the signed PDF
  const key = doc.signedKey || doc.originalKey;
  if (key && storageService.isStorageConfigured()) {
    const expiry = expiresInSeconds ?? storageService.ONE_WEEK_SECONDS;
    const url = await storageService.getSignedUrl(key, expiry);
    return url;
  }
  const filePath = doc.signedFilePath || doc.originalFilePath;
  if (filePath) {
    let url = `${baseUrl}/uploads/${filePath}`;
    if (doc.signedFilePath) {
      url += url.includes('?') ? '&' : '?';
      url += `v=signed&t=${Date.now()}`;
    }
    return url;
  }
  return null;
}

function isSignLinkExpired(signReq) {
  return signReq.expiresAt && new Date(signReq.expiresAt) < new Date();
}

// Public: get signed URL for document PDF (for signing page to load PDF). Prefer this over constructing /uploads/ path.
router.get('/:token/file-url', async (req, res) => {
  try {
    const { token } = req.params;
    const signReq = await SignRequest.findOne({ signLinkToken: token }).lean();
    if (!signReq) {
      return res.status(404).json({ error: 'Sign request not found' });
    }
    if (isSignLinkExpired(signReq)) {
      return res.status(410).json({ error: 'This link has expired', code: 'LINK_EXPIRED' });
    }
    const doc = await Document.findById(signReq.documentId).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = await getDocumentViewUrl(doc, baseUrl, storageService.ONE_WEEK_SECONDS);
    if (!url) {
      return res.status(404).json({ error: 'Document file not found' });
    }
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public: get sign request info by token
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const signReq = await SignRequest.findOne({ signLinkToken: token }).lean();
    if (!signReq) {
      return res.status(404).json({ error: 'Sign request not found' });
    }
    if (isSignLinkExpired(signReq)) {
      return res.status(410).json({ error: 'This link has expired', code: 'LINK_EXPIRED' });
    }
    const doc = await Document.findById(signReq.documentId).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await logEvent({
      documentId: signReq.documentId,
      signRequestId: signReq._id,
      actorType: 'signer',
      actorIdOrEmail: signReq.signerEmail,
      eventType: 'link_opened',
    });

    res.json({
      document: {
        id: doc._id,
        title: doc.title,
        status: doc.status,
        originalKey: doc.originalKey || null,
        signedKey: doc.signedKey || null,
        originalFilePath: doc.originalFilePath || null,
        signedFilePath: doc.signedFilePath || null,
        page1RenderWidth: doc.page1RenderWidth || null,
        page1RenderHeight: doc.page1RenderHeight || null,
      },
      signRequest: {
        id: signReq._id,
        signerName: signReq.signerName,
        signerEmail: signReq.signerEmail,
        status: signReq.status,
        signatureFields: signReq.signatureFields,
        ...(signReq.signatureData ? { signatureData: signReq.signatureData } : {}),
        ...(signReq.fieldSignatureData && Object.keys(signReq.fieldSignatureData).length > 0 ? { fieldSignatureData: signReq.fieldSignatureData } : {}),
        ...(signReq.fieldValues && Object.keys(signReq.fieldValues).length > 0 ? { fieldValues: signReq.fieldValues } : {}),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public: submit signature (saves signature only; recipient is not marked signed until they click Complete)
// If fieldId is provided, stores signature for that field only (per-field signing).
router.post('/:token/sign', async (req, res) => {
  try {
    const { token } = req.params;
    const { signatureData, fieldId } = req.body;
    if (!signatureData) {
      return res.status(400).json({ error: 'Signature data is required' });
    }
    const existing = await SignRequest.findOne({ signLinkToken: token }).lean();
    if (!existing) {
      return res.status(404).json({ error: 'Sign request not found' });
    }
    if (isSignLinkExpired(existing)) {
      return res.status(410).json({ error: 'This link has expired', code: 'LINK_EXPIRED' });
    }
    const signReq = await saveSignatureOnly({ token, signatureData, fieldId });
    if (!signReq) {
      return res.status(404).json({ error: 'Sign request not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public: save a typed field value (name, email, company, title, text, number)
router.patch('/:token/field-value', async (req, res) => {
  try {
    const { token } = req.params;
    const { fieldId, value } = req.body;
    if (fieldId == null || fieldId === '') {
      return res.status(400).json({ error: 'fieldId is required' });
    }
    const existing = await SignRequest.findOne({ signLinkToken: token }).lean();
    if (!existing) {
      return res.status(404).json({ error: 'Sign request not found' });
    }
    if (isSignLinkExpired(existing)) {
      return res.status(410).json({ error: 'This link has expired', code: 'LINK_EXPIRED' });
    }
    const signReq = await saveFieldValue({ token, fieldId, value });
    if (!signReq) {
      return res.status(404).json({ error: 'Sign request not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public: mark recipient as signed and embed signature in PDF (call when user clicks Complete)
router.post('/:token/complete', async (req, res) => {
  try {
    const { token } = req.params;
    const signReq = await SignRequest.findOne({ signLinkToken: token });
    if (!signReq) {
      return res.status(404).json({ error: 'Sign request not found' });
    }
    if (isSignLinkExpired(signReq)) {
      return res.status(410).json({ error: 'This link has expired', code: 'LINK_EXPIRED' });
    }
    if (signReq.status === 'signed') {
      return res.json({ success: true });
    }
    const sigFields = (signReq.signatureFields || []).filter((f) => {
      const t = String(f.type || 'signature').toLowerCase();
      return t === 'signature' || t === 'initial';
    });
    const hasPerField = signReq.fieldSignatureData && typeof signReq.fieldSignatureData === 'object' && Object.keys(signReq.fieldSignatureData).length > 0;
    const allFieldsSigned = sigFields.length === 0 || (hasPerField && sigFields.every((f) => signReq.fieldSignatureData[f.id]));
    const hasLegacy = !!signReq.signatureData;
    if (!allFieldsSigned && !hasLegacy) {
      return res.status(400).json({ error: 'Sign all required fields before completing' });
    }
    const ip =
      req.headers['x-forwarded-for'] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    await completeSigning({ token, ip, userAgent });
    res.json({ success: true });
  } catch (err) {
    console.error('[signing] complete failed', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Owner: audit logs for a document
router.get('/document/:documentId/audit-logs', async (req, res) => {
  try {
    const { documentId } = req.params;
    const logs = await AuditLog.find({ documentId }).sort({ createdAt: 1 }).lean();
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

