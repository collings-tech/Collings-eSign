const { mongoose } = require('../db/mongoose');

/**
 * Persistent OTP storage for multi-user / multi-instance setups.
 * type: 'signup_otp' | 'signup_verified' | 'profile_otp'
 * - signup_otp: key=email, stores otp for email verification
 * - signup_verified: key=email, no otp; marks email as verified (15 min window to complete signup)
 * - profile_otp: key=userId, stores otp for profile update verification
 */
const otpRecordSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    type: { type: String, required: true, enum: ['signup_otp', 'signup_verified', 'profile_otp', 'forgot_password_otp', 'forgot_password_verified'] },
    otp: { type: String },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

otpRecordSchema.index({ key: 1, type: 1 });
otpRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL: auto-delete expired docs

module.exports = mongoose.model('OtpRecord', otpRecordSchema);
