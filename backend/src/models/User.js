const { mongoose } = require('../db/mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: '', trim: true },
    profileImageUrl: { type: String, default: null },
    roles: { type: [String], enum: ['admin', 'user'], default: ['user'] },
    mustChangePassword: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);

