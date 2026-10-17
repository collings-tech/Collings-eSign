const Document = require('../models/Document');
const SignRequest = require('../models/SignRequest');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a document the signed-in user may read: the owner, or anyone who
 * holds a sign request on it (a signer). Returns null when neither applies or
 * the document is deleted. Same rule the file-url / download / detail routes
 * apply, pulled into one place so new read endpoints cannot forget it.
 */
async function findReadableDocument(documentId, user) {
  if (!user || !user.id) return null;
  let doc = await Document.findOne({ _id: documentId, ownerId: user.id }).lean();
  if (doc) return doc;
  const email = (user.email || '').toLowerCase();
  if (!email) return null;
  const signReq = await SignRequest.findOne({
    documentId,
    signerEmail: new RegExp(`^${escapeRegex(email)}$`, 'i'),
  }).lean();
  if (!signReq) return null;
  doc = await Document.findOne({ _id: documentId, status: { $ne: 'deleted' } }).lean();
  return doc || null;
}

module.exports = { findReadableDocument };
