const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument } = require('pdf-lib');
const { requireAuth } = require('../middleware/auth');
const Document = require('../models/Document');
const SignRequest = require('../models/SignRequest');
const User = require('../models/User');
const { uploadDir } = require('../config/env');
const { createSignRequest } = require('../services/signing.service');
const { sendDocuSignStyleSignEmail } = require('../services/email.service');
const { logEvent } = require('../services/audit.service');
const storageService = require('../services/storage.service');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Only PDF files are allowed'));
    cb(null, true);
  },
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 20 },
]);

// Parse optional JSON body fields (sent as strings in FormData)
function parseBodyFields(body) {
  const out = {};
  if (body.recipients != null) {
    try {
      out.recipients = typeof body.recipients === 'string' ? JSON.parse(body.recipients) : body.recipients;
    } catch {
      out.recipients = [];
    }
  }
  if (body.subject != null) out.subject = body.subject;
  if (body.message != null) out.message = body.message;
  if (body.reminderFrequency != null) out.reminderFrequency = body.reminderFrequency;
  if (body.signingOrder != null) out.signingOrder = body.signingOrder === 'true' || body.signingOrder === true;
  return out;
}

// Create & upload document (with optional envelope metadata and recipients)
// Accepts single 'file' or multiple 'files' (merged into one PDF)
router.post('/', requireAuth, upload, async (req, res) => {
  try {
    const fileList = req.files?.files || (req.files?.file ? req.files.file : []);
    const uploadedFiles = Array.isArray(fileList) ? fileList : [fileList];

    if (uploadedFiles.length === 0 || !uploadedFiles[0]) {
      return res.status(400).json({ error: 'PDF file is required' });
    }

    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const { recipients = [], subject = '', message = '', reminderFrequency = 'every_day', signingOrder = false } = parseBodyFields(req.body);

    let pdfBuffer;
    if (uploadedFiles.length === 1) {
      pdfBuffer = uploadedFiles[0].buffer;
    } else {
      const mergedPdf = await PDFDocument.create();
      for (const f of uploadedFiles) {
        const src = await PDFDocument.load(f.buffer);
        const pages = await mergedPdf.copyPages(src, src.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
    }

    const useStorage = storageService.isStorageConfigured();
    const doc = await Document.create({
      ownerId: req.user.id,
      title,
      originalFilePath: useStorage ? undefined : `${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`,
      status: 'draft',
      recipients: Array.isArray(recipients) ? recipients.map((r, i) => ({
        name: r.name || '',
        email: (r.email || '').toLowerCase().trim(),
        role: ['signer', 'cc', 'approver', 'viewer'].includes(r.role) ? r.role : 'signer',
        order: typeof r.order === 'number' ? r.order : i,
      })).filter((r) => r.name && r.email) : [],
      subject: String(subject || ''),
      message: String(message || ''),
      reminderFrequency: ['every_day', 'every_3_days', 'every_5_days', 'weekly', 'never'].includes(reminderFrequency) ? reminderFrequency : 'every_day',
      signingOrder: Boolean(signingOrder),
    });

    if (useStorage) {
      const key = storageService.originalKey(doc._id.toString());
      await storageService.upload(key, pdfBuffer);
      doc.originalKey = key;
      await doc.save();
    } else {
      await fs.writeFile(path.join(uploadDir, doc.originalFilePath), pdfBuffer);
    }

    // Create sign requests for signer recipients (no email sent yet; user will Send from detail)
    const signers = (doc.recipients || []).filter((r) => r.role === 'signer');
    for (const r of signers) {
      try {
        await createSignRequest({
          documentId: doc._id.toString(),
          ownerUser: { email: req.user.email },
          signerEmail: r.email,
          signerName: r.name,
          signatureFields: [],
          order: typeof r.order === 'number' ? r.order : 0,
          skipEmail: true,
          keepDraft: true,
        });
      } catch (err) {
        console.error('[documents] createSignRequest for recipient failed', err);
      }
    }

    res.status(201).json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List documents for current user (exclude deleted unless ?deleted=1)
router.get('/', requireAuth, async (req, res) => {
  try {
    const includeDeleted = req.query.deleted === '1' || req.query.deleted === 'true';
    const query = { ownerId: req.user.id };
    if (!includeDeleted) query.status = { $ne: 'deleted' };
    const docs = await Document.find(query)
      .sort({ createdAt: -1 })
      .lean();
    res.json(docs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List agreements with sign-request summary (owned + docs I need to sign)
router.get('/agreements', requireAuth, async (req, res) => {
  try {
    const includeDeleted = req.query.deleted === '1' || req.query.deleted === 'true';
    const myEmail = (req.user.email || '').toLowerCase();
    const myId = req.user.id;

    const signReqsWhereIMe = await SignRequest.find({
      signerEmail: new RegExp(`^${myEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      status: { $ne: 'signed' },
    })
      .select('documentId signLinkToken status signerName signerEmail')
      .lean();
    const signerDocIds = [...new Set(signReqsWhereIMe.map((sr) => sr.documentId.toString()))];

    const baseQuery = includeDeleted ? { status: 'deleted' } : { status: { $ne: 'deleted' } };
    const orClauses = [{ ownerId: myId, ...baseQuery }];
    if (signerDocIds.length && !includeDeleted) orClauses.push({ _id: signerDocIds, ...baseQuery });
    const docs = await Document.find(orClauses.length > 1 ? { $or: orClauses } : orClauses[0])
      .sort({ updatedAt: -1 })
      .lean();

    const docIds = docs.map((d) => d._id);
    const signReqs = await SignRequest.find({ documentId: { $in: docIds } })
      .select('documentId signerName signerEmail status signLinkToken')
      .lean();
    const byDoc = {};
    for (const sr of signReqs) {
      const id = sr.documentId.toString();
      if (!byDoc[id]) byDoc[id] = [];
      byDoc[id].push({
        _id: sr._id,
        signerName: sr.signerName,
        signerEmail: sr.signerEmail,
        status: sr.status,
        signLinkToken: sr.signLinkToken,
      });
    }
    const agreements = docs.map((d) => {
      const id = d._id.toString();
      const signRequests = byDoc[id] || [];
      const mySignRequest = signRequests.find((sr) => (sr.signerEmail || '').toLowerCase() === myEmail) || null;
      return { ...d, signRequests, mySignRequest };
    });
    res.json(agreements);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Past recipients: unique name+email from all documents owned by the user (for suggestions)
router.get('/past-recipients', requireAuth, async (req, res) => {
  try {
    const docs = await Document.find({ ownerId: req.user.id })
      .select('recipients')
      .lean();
    const seen = new Set();
    const list = [];
    for (const doc of docs) {
      for (const r of doc.recipients || []) {
        const email = (r.email || '').toLowerCase().trim();
        const name = (r.name || '').trim();
        if (!email) continue;
        const key = `${email}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ name, email });
      }
    }
    list.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resolve view URL for a document (signed version if exists, else original). For storage: signed URL (1 year for in-app).
async function getDocumentViewUrl(doc, baseUrl) {
  const key = doc.signedKey || doc.originalKey;
  if (key && storageService.isStorageConfigured()) {
    return storageService.getSignedUrl(key, storageService.ONE_YEAR_SECONDS);
  }
  const filePath = doc.signedFilePath || doc.originalFilePath;
  if (filePath) {
    return `${baseUrl}/uploads/${filePath}`;
  }
  return null;
}

// Get signed/view URL for document PDF (owner or signer). Use this URL to display or download the PDF.
router.get('/:id/file-url', requireAuth, async (req, res) => {
  try {
    let doc = await Document.findOne({ _id: req.params.id, ownerId: req.user.id }).lean();
    if (!doc) {
      const myEmail = (req.user.email || '').toLowerCase();
      const signReq = await SignRequest.findOne({
        documentId: req.params.id,
        signerEmail: new RegExp(`^${myEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      }).lean();
      if (!signReq) {
        return res.status(404).json({ error: 'Document not found' });
      }
      doc = await Document.findOne({ _id: req.params.id, status: { $ne: 'deleted' } }).lean();
    }
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = await getDocumentViewUrl(doc, baseUrl);
    if (!url) {
      return res.status(404).json({ error: 'Document file not found' });
    }
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single document (owner or signer)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    let doc = await Document.findOne({ _id: req.params.id, ownerId: req.user.id }).lean();
    if (doc) {
      // Owner view: add owner info for consistent "From" display (name, email, avatar)
      const owner = await User.findById(req.user.id).select('name email profileImageUrl').lean();
      const docWithOwner = { ...doc, ownerName: owner?.name, ownerEmail: owner?.email, ownerProfileImageUrl: owner?.profileImageUrl };
      return res.json(docWithOwner);
    }
    // Signer view: user has a SignRequest for this document
    const myEmail = (req.user.email || '').toLowerCase();
    const signReq = await SignRequest.findOne({
      documentId: req.params.id,
      signerEmail: new RegExp(`^${myEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    }).lean();
    if (!signReq) {
      return res.status(404).json({ error: 'Document not found' });
    }
    doc = await Document.findOne({ _id: req.params.id, status: { $ne: 'deleted' } }).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    // Add owner info for signer view (for "From" display)
    const owner = await User.findById(doc.ownerId).select('name email profileImageUrl').lean();
    const docWithOwner = { ...doc, ownerName: owner?.name, ownerEmail: owner?.email, ownerProfileImageUrl: owner?.profileImageUrl };
    res.json(docWithOwner);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save signing field placements per recipient (draft only)
// Optional body: page1RenderWidth, page1RenderHeight — used for accurate signature placement when embedding
router.put('/:id/signing-fields', requireAuth, async (req, res) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, ownerId: req.user.id });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    if (doc.status !== 'draft') {
      return res.status(400).json({ error: 'Can only edit fields on draft documents' });
    }
    const { fields = [], page1RenderWidth, page1RenderHeight } = req.body;
    if (page1RenderWidth != null && Number(page1RenderWidth) > 0) {
      doc.page1RenderWidth = Number(page1RenderWidth);
      doc.page1RenderHeight = page1RenderHeight != null && Number(page1RenderHeight) > 0 ? Number(page1RenderHeight) : undefined;
      await doc.save();
    }
    const signReqs = await SignRequest.find({ documentId: doc._id });
    const typeMap = { Signature: 'signature', Initial: 'initial', signature: 'signature', initial: 'initial' };
    for (const sr of signReqs) {
      const srIdStr = sr._id.toString();
      const forThisSigner = (fields || [])
        .filter((f) => f.signRequestId != null && String(f.signRequestId) === srIdStr)
        .map((f) => ({
          id: f.id || undefined,
          page: Number(f.page) || 1,
          x: Number(f.x) || 0,
          y: Number(f.y) || 0,
          width: Number(f.width) || 160,
          height: Number(f.height) || 36,
          type: typeMap[f.type] || 'signature',
          required: f.required !== false,
          dataLabel: String(f.dataLabel || '').slice(0, 200),
          tooltip: String(f.tooltip || '').slice(0, 500),
          scale: Math.min(200, Math.max(50, Number(f.scale) || 100)),
        }));
      sr.signatureFields = forThisSigner;
      await sr.save();
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Normalize email send failures (bounce, invalid, rejected) to a user-friendly message.
function getEmailSendErrorMessage(emailErr, signerEmail) {
  const raw = emailErr && (emailErr.message || (typeof emailErr.response === 'string' ? emailErr.response : ''));
  const msg = (raw || (emailErr ? String(emailErr) : '')).toLowerCase();
  const isBounceOrInvalid =
    /bounce|invalid|reject|not found|unknown|mailbox|address|550|551|552|553|554|recipient|delivery failed|undeliverable/i.test(msg) ||
    (emailErr && (emailErr.code === 'EENVELOPE' || emailErr.code === 'EDNS'));
  const recipient = signerEmail ? ` (${signerEmail})` : '';
  if (isBounceOrInvalid) {
    return `The email${recipient} bounced or is invalid. Please check the recipient's email address and try again.`;
  }
  return `The email could not be delivered${recipient}. Please check the recipient's email address and try again.`;
}

// Send Collings eSign-style emails to recipients. If signing order is set, only the first signer (order 1) receives the email; the rest receive it after the previous signer completes.
router.post('/:id/send', requireAuth, async (req, res) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, ownerId: req.user.id }).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    let signReqs = await SignRequest.find({ documentId: doc._id }).lean();
    if (!signReqs.length) {
      return res.status(400).json({ error: 'No recipients to send to. Add signers for this document first.' });
    }

    const senderName = req.user.name || req.user.email || 'Someone';
    const senderEmail = req.user.email || '';
    const documentTitle = doc.title || 'Document';

    if (doc.signingOrder) {
      signReqs = signReqs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const minOrder = Math.min(...signReqs.map((sr) => sr.order ?? 0));
      signReqs = signReqs.filter((sr) => (sr.order ?? 0) === minOrder && !sr.emailSentAt);
    }

    // When signing order is off, send to all signers so everyone receives at the same time (including owner if they're a signer)
    const ownerEmail = (req.user.email || '').toLowerCase();
    for (const sr of signReqs) {
      const isOwnerSigner = (sr.signerEmail || '').toLowerCase() === ownerEmail;
      if (!isOwnerSigner || !doc.signingOrder) {
        try {
          await sendDocuSignStyleSignEmail({
            signerEmail: sr.signerEmail,
            signerName: sr.signerName,
            token: sr.signLinkToken,
            documentTitle,
            senderName,
            senderEmail,
          });
        } catch (emailErr) {
          console.error('[documents] send failed for', sr.signerEmail, emailErr);
          const userMessage = getEmailSendErrorMessage(emailErr, sr.signerEmail);
          return res.status(400).json({ error: userMessage });
        }
      }
      await SignRequest.findByIdAndUpdate(sr._id, { emailSentAt: new Date() });
      await logEvent({
        documentId: doc._id.toString(),
        signRequestId: sr._id,
        actorType: 'sender',
        actorIdOrEmail: senderEmail,
        eventType: 'sent_for_signature',
        meta: { signerEmail: sr.signerEmail, signerName: sr.signerName },
      });
    }

    const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await SignRequest.updateMany({ documentId: doc._id }, { $set: { expiresAt: oneWeekFromNow } });
    await Document.findByIdAndUpdate(doc._id, { status: 'pending', sentAt: new Date() });

    res.json({ success: true, sentCount: signReqs.length });
  } catch (err) {
    console.error('[documents] send failed', err);
    const message = err.message || 'Failed to send emails';
    res.status(500).json({ error: message });
  }
});

// Resend to current recipients (all who have not yet signed).
// Optional body: { recipients: [ { signRequestId, email, name } ] } to update recipient email/name before sending.
router.post('/:id/resend', requireAuth, async (req, res) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, ownerId: req.user.id }).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    let signReqs = await SignRequest.find({ documentId: doc._id, status: { $ne: 'signed' } }).lean();
    if (!signReqs.length) {
      return res.json({ success: true, sentCount: 0 });
    }
    const recipientsOverride = Array.isArray(req.body.recipients) ? req.body.recipients : [];
    const overrideMap = new Map(recipientsOverride.map((r) => [String(r.signRequestId), r]));

    const senderName = req.user.name || req.user.email || 'Someone';
    const senderEmail = req.user.email || '';
    const documentTitle = doc.title || 'Document';
    const ownerEmail = (req.user.email || '').toLowerCase();

    for (const sr of signReqs) {
      const override = overrideMap.get(String(sr._id));
      let signerEmail = sr.signerEmail;
      let signerName = sr.signerName;
      if (override) {
        if (override.email && String(override.email).trim()) {
          signerEmail = String(override.email).toLowerCase().trim();
          signerName = override.name != null ? String(override.name).trim() : signerName;
          await SignRequest.findByIdAndUpdate(sr._id, { signerEmail, signerName });
        }
      }
      const isOwnerSigner = signerEmail.toLowerCase() === ownerEmail;
      if (!isOwnerSigner) {
        try {
          await sendDocuSignStyleSignEmail({
            signerEmail,
            signerName,
            token: sr.signLinkToken,
            documentTitle,
            senderName,
            senderEmail,
          });
        } catch (emailErr) {
          console.error('[documents] resend failed for', signerEmail, emailErr);
          const userMessage = getEmailSendErrorMessage(emailErr, signerEmail);
          return res.status(400).json({ error: userMessage });
        }
      }
      const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await SignRequest.findByIdAndUpdate(sr._id, { emailSentAt: new Date(), expiresAt: oneWeekFromNow });
      await logEvent({
        documentId: doc._id.toString(),
        signRequestId: sr._id,
        actorType: 'sender',
        actorIdOrEmail: senderEmail,
        eventType: 'sent_for_signature',
        meta: { signerEmail, signerName, resend: true },
      });
    }
    res.json({ success: true, sentCount: signReqs.length });
  } catch (err) {
    console.error('[documents] resend failed', err);
    res.status(500).json({ error: err.message || 'Failed to resend' });
  }
});

// Trash (soft delete) document
router.patch('/:id/trash', requireAuth, async (req, res) => {
  try {
    const doc = await Document.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.user.id },
      { status: 'deleted' },
      { new: true }
    );
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update basic metadata
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { title, status } = req.body;
    const update = {};
    if (title) update.title = title;
    if (status) update.status = status;

    const doc = await Document.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.user.id },
      { $set: update },
      { new: true }
    );
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove a single page from the document PDF (draft only). pageIndex is 1-based.
router.delete('/:id/pages/:pageIndex', requireAuth, async (req, res) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, ownerId: req.user.id });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    if (doc.status !== 'draft') {
      return res.status(400).json({ error: 'Can only edit pages in draft documents' });
    }
    const pageIndex = parseInt(req.params.pageIndex, 10);
    if (!Number.isInteger(pageIndex) || pageIndex < 1) {
      return res.status(400).json({ error: 'Invalid page index' });
    }

    let pdfBytes;
    const useStorage = doc.originalKey && storageService.isStorageConfigured();
    if (useStorage) {
      pdfBytes = await storageService.download(doc.originalKey);
    } else {
      pdfBytes = await fs.readFile(path.join(uploadDir, doc.originalFilePath));
    }

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();
    if (pageIndex > totalPages) {
      return res.status(400).json({ error: 'Page index out of range' });
    }
    if (totalPages <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only page' });
    }
    pdfDoc.removePage(pageIndex - 1);
    const newBytes = await pdfDoc.save();
    const outBuffer = Buffer.from(newBytes);

    if (useStorage) {
      await storageService.upload(doc.originalKey, outBuffer);
    } else {
      await fs.writeFile(path.join(uploadDir, doc.originalFilePath), outBuffer);
    }
    res.json({ success: true, pageCount: totalPages - 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

