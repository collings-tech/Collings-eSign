const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const SignupRequest = require('../models/SignupRequest');
const User = require('../models/User');
const { requireAdmin } = require('../middleware/auth');
const { sendSignupApprovedEmail } = require('../services/email.service');

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  const buf = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) s += chars[buf[i] % chars.length];
  return s;
}

const router = express.Router();

// List pending signup requests
router.get('/', requireAdmin, async (req, res) => {
  try {
    const items = await SignupRequest.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .lean();
    res.json(
      items.map((r) => ({
        id: r._id.toString(),
        email: r.email,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve a signup request
router.post('/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const request = await SignupRequest.findById(id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const existingUser = await User.findOne({ email: request.email });
    if (existingUser) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    await User.create({
      email: request.email,
      passwordHash,
      name: '',
      roles: ['user'],
      mustChangePassword: true,
    });

    request.status = 'approved';
    await request.save();

    try {
      if (request.email) {
        await sendSignupApprovedEmail({ to: request.email, temporaryPassword: tempPassword });
      }
    } catch (err) {
      console.error('[signup] Failed to send signup-approved email to', request.email, err);
    }

    res.json({
      ok: true,
      request: {
        id: request._id.toString(),
        email: request.email,
        status: request.status,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Optional: reject a signup request
router.post('/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const request = await SignupRequest.findById(id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    request.status = 'rejected';
    await request.save();
    res.json({
      ok: true,
      request: {
        id: request._id.toString(),
        email: request.email,
        status: request.status,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

