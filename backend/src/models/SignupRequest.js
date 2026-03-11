const { mongoose } = require('../db/mongoose');

const signupRequestSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);

signupRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('SignupRequest', signupRequestSchema);

