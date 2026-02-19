const express = require('express');
const SignRequest = require('../models/SignRequest');
const Document = require('../models/Document');
const { saveSignatureOnly, completeSigning } = require('../services/signing.service');
const AuditLog = require('../models/AuditLog');
const { logEvent } = require('../services/audit.service');

const router = express.Router();

// Public: get sign request info by token
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const signReq = await SignRequest.findOne({ signLinkToken: token }).lean();
    if (!signReq) {
      return res.status(404).json({ error: 'Sign request not found' });
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
        originalFilePath: doc.originalFilePath,
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
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public: submit signature (saves signature only; recipient is not marked signed until they click Complete)
router.post('/:token/sign', async (req, res) => {
  try {
    const { token } = req.params;
    const { signatureData } = req.body;
    if (!signatureData) {
      return res.status(400).json({ error: 'Signature data is required' });
    }
    const signReq = await saveSignatureOnly({ token, signatureData });
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
    if (signReq.status === 'signed') {
      return res.json({ success: true });
    }
    if (!signReq.signatureData) {
      return res.status(400).json({ error: 'Sign the document first before completing' });
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

