const express = require("express");
const { requireAuth } = require("../middleware/auth");
const Document = require("../models/Document");
const SignRequest = require("../models/SignRequest");
const User = require("../models/User");
const { createSignRequest } = require("../services/signing.service");

const router = express.Router();

// Create a sign request for a document
router.post("/:documentId", requireAuth, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { signerEmail, signerName, signatureFields, skipEmail } = req.body;

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

    const signReq = await createSignRequest({
      documentId,
      ownerUser: { email: req.user.email },
      signerEmail,
      signerName,
      signatureFields,
      skipEmail: Boolean(skipEmail),
    });

    res.status(201).json(signReq);
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
      .sort({ createdAt: -1 })
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
