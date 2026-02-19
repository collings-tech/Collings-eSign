const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const OtpRecord = require('../models/OtpRecord');
const { signToken, authOptional, requireAuth } = require('../middleware/auth');
const { sendProfileOtpEmail, sendSignupOtpEmail, sendForgotPasswordOtpEmail } = require('../services/email.service');
const { uploadDir } = require('../config/env');

const router = express.Router();

const profilesDir = path.join(uploadDir, 'profiles');
if (!fs.existsSync(profilesDir)) {
  fs.mkdirSync(profilesDir, { recursive: true });
}

const profilePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, profilesDir),
    filename: (req, file, cb) => {
      const ext = (file.originalname && path.extname(file.originalname).toLowerCase()) || '.jpg';
      const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
      cb(null, `${req.user.id}${safeExt}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, GIF, or WebP images are allowed'));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('photo');

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const SIGNUP_VERIFIED_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function verifyRecaptcha(token) {
  // Captcha disabled
  return true;
}

// Step 1: Send OTP to email
router.post('/signup-send-otp', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    await OtpRecord.findOneAndUpdate(
      { key: email, type: 'signup_otp' },
      { otp, expiresAt },
      { upsert: true, new: true }
    );
    await sendSignupOtpEmail({ to: email, otp });
    res.json({ ok: true, message: 'Verification code sent to your email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to send verification code.' });
  }
});

// Step 2: Verify OTP
router.post('/signup-verify-otp', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const otp = String(req.body.otp || '').trim();
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }
    const stored = await OtpRecord.findOne({ key: email, type: 'signup_otp' });
    if (!stored) {
      return res.status(400).json({ error: 'No verification code found. Request a new code.' });
    }
    if (Date.now() > stored.expiresAt.getTime()) {
      await OtpRecord.deleteOne({ key: email, type: 'signup_otp' });
      return res.status(400).json({ error: 'Verification code expired. Request a new code.' });
    }
    if (otp !== stored.otp) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }
    await OtpRecord.deleteOne({ key: email, type: 'signup_otp' });
    await OtpRecord.findOneAndUpdate(
      { key: email, type: 'signup_verified' },
      { expiresAt: new Date(Date.now() + SIGNUP_VERIFIED_EXPIRY_MS) },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Step 3: Complete signup (after email verified)
router.post('/signup', async (req, res) => {
  try {
    const { email, firstName, lastName, password, retypePassword, captchaToken } = req.body;
    const trimmedEmail = (email || '').toLowerCase().trim();
    if (!trimmedEmail || !firstName || !lastName || !password) {
      return res.status(400).json({ error: 'Email, first name, last name and password are required' });
    }
    if (password !== retypePassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const verified = await OtpRecord.findOne({ key: trimmedEmail, type: 'signup_verified' });
    if (!verified || Date.now() > verified.expiresAt.getTime()) {
      await OtpRecord.deleteOne({ key: trimmedEmail, type: 'signup_verified' });
      return res.status(400).json({ error: 'Email verification expired. Please start over.' });
    }
    await OtpRecord.deleteOne({ key: trimmedEmail, type: 'signup_verified' });

    const captchaOk = await verifyRecaptcha(captchaToken);
    if (!captchaOk) {
      return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
    }

    const existing = await User.findOne({ email: trimmedEmail });
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const name = [firstName, lastName].map((s) => String(s || '').trim()).filter(Boolean).join(' ') || 'User';
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email: trimmedEmail, passwordHash, name });
    const token = signToken(user);

    res.status(201).json({
      token,
      user: { id: user._id.toString(), email: user.email, name: user.name, profileImageUrl: user.profileImageUrl || null },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Forgot password flow ---

// Step 1: Send OTP to email (user must exist)
router.post('/forgot-password-send-otp', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'No account found with this email' });
    }
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    await OtpRecord.findOneAndUpdate(
      { key: email, type: 'forgot_password_otp' },
      { otp, expiresAt },
      { upsert: true, new: true }
    );
    await sendForgotPasswordOtpEmail({ to: email, otp });
    res.json({ ok: true, message: 'Verification code sent to your email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to send verification code.' });
  }
});

// Step 2: Verify OTP
router.post('/forgot-password-verify-otp', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const otp = String(req.body.otp || '').trim();
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }
    const stored = await OtpRecord.findOne({ key: email, type: 'forgot_password_otp' });
    if (!stored) {
      return res.status(400).json({ error: 'No verification code found. Request a new code.' });
    }
    if (Date.now() > stored.expiresAt.getTime()) {
      await OtpRecord.deleteOne({ key: email, type: 'forgot_password_otp' });
      return res.status(400).json({ error: 'Verification code expired. Request a new code.' });
    }
    if (otp !== stored.otp) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }
    await OtpRecord.deleteOne({ key: email, type: 'forgot_password_otp' });
    await OtpRecord.findOneAndUpdate(
      { key: email, type: 'forgot_password_verified' },
      { expiresAt: new Date(Date.now() + OTP_EXPIRY_MS) },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Step 3: Reset password (after OTP verified)
router.post('/forgot-password-reset', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const { password, retypePassword } = req.body;
    if (!email || !password || !retypePassword) {
      return res.status(400).json({ error: 'Email, password and retype password are required' });
    }
    if (password !== retypePassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const verified = await OtpRecord.findOne({ key: email, type: 'forgot_password_verified' });
    if (!verified || Date.now() > verified.expiresAt.getTime()) {
      await OtpRecord.deleteOne({ key: email, type: 'forgot_password_verified' });
      return res.status(400).json({ error: 'Verification expired. Please start over.' });
    }
    await OtpRecord.deleteOne({ key: email, type: 'forgot_password_verified' });

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'Account not found' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await User.findByIdAndUpdate(user._id, { $set: { passwordHash } });
    res.json({ ok: true, message: 'Password reset successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user._id.toString(), email: user.email, name: user.name, profileImageUrl: user.profileImageUrl || null },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authOptional, requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

// Update profile – name/email require OTP; use POST /verify-profile-update for those
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const { name, email } = req.body;
    if (name !== undefined || email !== undefined) {
      return res.status(400).json({
        error: 'To update name or email, use the verification flow: request a code, then verify with POST /auth/verify-profile-update.',
      });
    }
    res.json({ user: req.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send OTP to user's email for profile update verification
router.post('/send-profile-otp', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    await OtpRecord.findOneAndUpdate(
      { key: userId, type: 'profile_otp' },
      { otp, expiresAt },
      { upsert: true, new: true }
    );
    await sendProfileOtpEmail({ to: req.user.email, otp });
    res.json({ ok: true, message: 'Verification code sent to your email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to send code.' });
  }
});

// Verify OTP and apply profile update (name and/or email)
router.post('/verify-profile-update', requireAuth, async (req, res) => {
  try {
    const { otp, name, email } = req.body;
    const userId = req.user.id;
    const stored = await OtpRecord.findOne({ key: userId, type: 'profile_otp' });
    if (!stored) return res.status(400).json({ error: 'No verification code found. Request a new code.' });
    if (Date.now() > stored.expiresAt.getTime()) {
      await OtpRecord.deleteOne({ key: userId, type: 'profile_otp' });
      return res.status(400).json({ error: 'Verification code expired. Request a new code.' });
    }
    if (String(otp).trim() !== stored.otp) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }
    await OtpRecord.deleteOne({ key: userId, type: 'profile_otp' });

    const update = {};
    if (name != null && String(name).trim()) update.name = String(name).trim();
    if (email != null) {
      const trimmed = String(email).toLowerCase().trim();
      if (!trimmed) return res.status(400).json({ error: 'Email is required' });
      const existing = await User.findOne({ email: trimmed, _id: { $ne: userId } });
      if (existing) return res.status(409).json({ error: 'Email already in use' });
      update.email = trimmed;
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Provide name and/or email to update.' });
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: update },
      { new: true, runValidators: true }
    );
    res.json({
      user: { id: user._id.toString(), email: user.email, name: user.name, profileImageUrl: user.profileImageUrl || null },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify current password (for gating password change form)
router.post('/verify-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword } = req.body;
    if (!currentPassword) {
      return res.status(400).json({ error: 'Current password is required' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password – requires current password verification first
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(req.user.id, { $set: { passwordHash } });
    res.json({ ok: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload profile photo (image file); updates user.profileImageUrl and returns updated user
router.post('/upload-profile-photo', requireAuth, (req, res, next) => {
  profilePhotoUpload(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Image must be 5MB or smaller.' });
        if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Use field name "photo" for the file.' });
      }
      return res.status(400).json({ error: err.message || 'Invalid file.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Choose an image and try again.' });
    }
    const relativePath = path.join('profiles', req.file.filename);
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { profileImageUrl: relativePath } },
      { new: true, runValidators: true }
    );
    res.json({
      user: { id: user._id.toString(), email: user.email, name: user.name, profileImageUrl: user.profileImageUrl || null },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

