const crypto = require("crypto");
const Document = require("../models/Document");
const SignRequest = require("../models/SignRequest");
const User = require("../models/User");
const { logEvent } = require("./audit.service");
const { sendSignRequestEmail, sendDocuSignStyleSignEmail, sendDocumentCompletedEmail, sendSignedWaitingForOthersEmail } = require("./email.service");
const { embedSignatureInPdf } = require("./pdfSign.service");

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function createSignRequest({
  documentId,
  ownerUser,
  signerEmail,
  signerName,
  signatureFields,
  order = 0,
  skipEmail = false,
  keepDraft = false,
}) {
  const token = generateToken();
  const signRequest = await SignRequest.create({
    documentId,
    signerEmail,
    signerName,
    signLinkToken: token,
    order: typeof order === 'number' ? order : 0,
    signatureFields: signatureFields || [],
  });

  if (!keepDraft) {
    const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await SignRequest.findByIdAndUpdate(signRequest._id, { expiresAt: oneWeekFromNow });
    await logEvent({
      documentId,
      signRequestId: signRequest._id,
      actorType: "sender",
      actorIdOrEmail: ownerUser.email,
      eventType: "sent_for_signature",
      meta: { signerEmail, signerName },
    });
    await Document.findByIdAndUpdate(documentId, { status: "pending" });
  }

  if (!skipEmail && !keepDraft) {
    try {
      const doc = await Document.findById(documentId).lean();
      await sendSignRequestEmail({
        signerEmail,
        signerName,
        token,
        documentTitle: doc?.title || "Document",
        ownerEmail: ownerUser.email,
      });
    } catch (err) {
      // Log but don't fail the API if email sending has an issue
      // eslint-disable-next-line no-console
      console.error("[email] Failed to send sign request email", err);
    }
  }

  return signRequest;
}

/** Save signature only; do NOT embed in PDF until Complete. */
async function saveSignatureOnly({ token, signatureData }) {
  const signRequest = await SignRequest.findOne({ signLinkToken: token });
  if (!signRequest) return null;
  if (signRequest.status === "signed") return signRequest;
  signRequest.signatureData = signatureData;
  await signRequest.save();
  return signRequest;
}

/** Mark recipient as signed. Call when recipient clicks Complete. Embed signature in PDF here. */
async function completeSigning({ token, ip, userAgent }) {
  const signRequest = await SignRequest.findOne({ signLinkToken: token });
  if (!signRequest) return null;
  if (signRequest.status === "signed") return signRequest;
  if (!signRequest.signatureData) {
    return null; // Must have signed first
  }

  const doc = await Document.findById(signRequest.documentId).lean();
  if (!doc) {
    throw new Error("Document not found");
  }

  let signedResult;
  try {
    signedResult = await embedSignatureInPdf(doc, signRequest);
  } catch (err) {
    console.error("[signing] embedSignatureInPdf failed", err);
    throw err;
  }

  const update = {};
  if (signedResult.startsWith("documents/")) {
    update.signedKey = signedResult;
  } else {
    update.signedFilePath = signedResult;
  }
  await Document.findByIdAndUpdate(signRequest.documentId, update);

  signRequest.status = "signed";
  signRequest.signedAt = new Date();
  signRequest.signerIp = ip;
  signRequest.userAgent = userAgent;
  await signRequest.save();

  await logEvent({
    documentId: signRequest.documentId,
    signRequestId: signRequest._id,
    actorType: "signer",
    actorIdOrEmail: signRequest.signerEmail,
    eventType: "signed",
  });

  const documentTitle = doc.title || "Document";

  // Only treat envelope as complete when every signer has signed (fresh count from DB)
  const totalSigners = await SignRequest.countDocuments({
    documentId: signRequest.documentId,
  });
  const signedCount = await SignRequest.countDocuments({
    documentId: signRequest.documentId,
    status: "signed",
  });
  const allSigned = totalSigners > 0 && totalSigners === signedCount;

  if (allSigned) {
    await Document.findByIdAndUpdate(signRequest.documentId, {
      status: "completed",
      signedAt: new Date(),
    });
    // Email the completed document to ALL recipients only when envelope is fully complete
    const allForDoc = await SignRequest.find({
      documentId: signRequest.documentId,
    }).lean();
    try {
      for (const sr of allForDoc) {
        await sendDocumentCompletedEmail({
          to: sr.signerEmail,
          recipientName: sr.signerName,
          token: sr.signLinkToken,
          documentTitle,
        });
      }
    } catch (err) {
      console.error("[signing] sendDocumentCompletedEmail to all failed", err);
    }
  } else {
    // Not all signed: tell this signer they've signed and will get the document by email when envelope is complete
    try {
      await sendSignedWaitingForOthersEmail({
        to: signRequest.signerEmail,
        recipientName: signRequest.signerName,
        documentTitle,
      });
    } catch (err) {
      console.error("[signing] sendSignedWaitingForOthersEmail failed", err);
    }
    // If signing order is set, send the next signer in order
    await sendToNextSignerInOrder(signRequest.documentId.toString());
  }

  return signRequest;
}

/** When document has signing order, send email to the next signer who has not yet been sent to. */
async function sendToNextSignerInOrder(documentId) {
  const doc = await Document.findById(documentId).lean();
  if (!doc || !doc.signingOrder) return;

  const signReqs = await SignRequest.find({ documentId }).lean();
  const sorted = signReqs.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const next = sorted.find((sr) => !sr.emailSentAt && sr.status !== "signed");
  if (!next) return;

  const owner = await User.findById(doc.ownerId).lean();
  const senderName = owner?.name || owner?.email || "Someone";

  try {
    await sendDocuSignStyleSignEmail({
      signerEmail: next.signerEmail,
      signerName: next.signerName,
      token: next.signLinkToken,
      documentTitle: doc.title || "Document",
      senderName,
    });
    await SignRequest.findByIdAndUpdate(next._id, { emailSentAt: new Date() });
    await logEvent({
      documentId,
      signRequestId: next._id,
      actorType: "system",
      actorIdOrEmail: "signing-order",
      eventType: "sent_for_signature",
      meta: { signerEmail: next.signerEmail, signerName: next.signerName, afterPreviousSigner: true },
    });
  } catch (err) {
    console.error("[signing] sendToNextSignerInOrder failed", err);
  }
}

module.exports = {
  createSignRequest,
  saveSignatureOnly,
  completeSigning,
};
