const { mongoose } = require('../db/mongoose');

const recipientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: {
      type: String,
      enum: ['signer', 'cc', 'approver', 'viewer'],
      default: 'signer',
    },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    originalFilePath: { type: String, required: true },
    signedFilePath: { type: String },
    status: {
      type: String,
      enum: ['draft', 'pending', 'completed', 'cancelled', 'deleted'],
      default: 'draft',
    },
    recipients: [recipientSchema],
    subject: { type: String, default: '' },
    message: { type: String, default: '' },
    reminderFrequency: {
      type: String,
      enum: ['every_day', 'every_3_days', 'every_5_days', 'weekly', 'never'],
      default: 'every_day',
    },
    signingOrder: { type: Boolean, default: false },
    sentAt: { type: Date }, // set when envelope is sent (status → pending)
    // Render size of first page when fields were placed (for accurate signature placement)
    page1RenderWidth: { type: Number },
    page1RenderHeight: { type: Number },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Document', documentSchema);

