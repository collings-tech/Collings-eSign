const express = require("express");
const { requireAuth } = require("../middleware/auth");
const Document = require("../models/Document");
const SignRequest = require("../models/SignRequest");
const User = require("../models/User");
const { createSignRequest } = require("../services/signing.service");

const router = express.Router();

// Create a sign request for a document (e.g. when adding a recipient from "Back" on prepare step)
router.post("/:documentId", requireAuth, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { signerEmail, signerName, signatureFields, skipEmail, keepDraft, order } = req.body;

    if (!signerEmail || !signerName) {
      return res
        .status(400)
        .json({ error: "Signer email and name are required" });
    }

    const doc = await Document.findOne({
      _id: documentId,
      ownerId: req.user.id,
    });
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    // When adding a signer to a draft (e.g. after clicking Back and adding recipient), keep doc as draft
    const isDraft = doc.status === "draft";
    const signReq = await createSignRequest({
      documentId,
      ownerUser: { email: req.user.email },
      signerEmail: String(signerEmail).trim(),
      signerName: String(signerName || "").trim(),
      signatureFields: signatureFields || [],
      skipEmail: Boolean(skipEmail),
      keepDraft: Boolean(keepDraft ?? isDraft),
      order: typeof order === "number" ? order : undefined,
    });

    res.status(201).json(signReq);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a single sign request (only for draft docs, unsigned signers, owner only)
router.delete("/:documentId/:signRequestId", requireAuth, async (req, res) => {
  try {
    const { documentId, signRequestId } = req.params;
    const doc = await Document.findOne({ _id: documentId, ownerId: req.user.id });
    if (!doc) return res.status(404).json({ error: "Document not found" });
    const signReq = await SignRequest.findOne({ _id: signRequestId, documentId });
    if (!signReq) return res.status(404).json({ error: "Sign request not found" });
    if (signReq.status === "signed") {
      return res.status(400).json({ error: "Cannot remove a recipient who has already signed" });
    }
    await SignRequest.deleteOne({ _id: signRequestId });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List sign requests for a document (owner or signer)
router.get("/:documentId", requireAuth, async (req, res) => {
  try {
    const { documentId } = req.params;
    let doc = await Document.findOne({
      _id: documentId,
      ownerId: req.user.id,
    });
    if (!doc) {
      const myEmail = (req.user.email || "").toLowerCase();
      const mySignReq = await SignRequest.findOne({
        documentId,
        signerEmail: new RegExp(`^${myEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      });
      if (!mySignReq) {
        return res.status(404).json({ error: "Document not found" });
      }
      doc = await Document.findOne({ _id: documentId, status: { $ne: "deleted" } });
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }
    }
    const signReqs = await SignRequest.find({ documentId })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    const emails = [...new Set(signReqs.map((sr) => (sr.signerEmail || "").toLowerCase()).filter(Boolean))];
    const usersByEmail = {};
    if (emails.length > 0) {
      const users = await User.find({ email: { $in: emails } }).select("email profileImageUrl").lean();
      users.forEach((u) => {
        usersByEmail[(u.email || "").toLowerCase()] = u.profileImageUrl || null;
      });
    }
    const signReqsWithProfile = signReqs.map((sr) => ({
      ...sr,
      signerProfileImageUrl: usersByEmail[(sr.signerEmail || "").toLowerCase()] || null,
    }));
    res.json(signReqsWithProfile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
