const { mongoose } = require('../db/mongoose');

const signatureFieldSchema = new mongoose.Schema(
  {
    id: { type: String },
    page: { type: Number, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    type: { type: String, enum: ['signature', 'initial', 'text', 'date', 'name', 'email'], default: 'signature' },
    required: { type: Boolean, default: true },
    dataLabel: { type: String, default: '' },
    tooltip: { type: String, default: '' },
    scale: { type: Number, default: 100 },
  },
  { _id: false }
);

const signRequestSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
    signerEmail: { type: String, required: true, lowercase: true, trim: true },
    signerName: { type: String, required: true, trim: true },
    signLinkToken: { type: String, required: true, unique: true },
    order: { type: Number, default: 0 }, // signing order (1 = first to receive and sign)
    emailSentAt: { type: Date }, // when the sign link email was sent (for sequential flow)
    expiresAt: { type: Date },
    status: {
      type: String,
      enum: ['pending', 'viewed', 'signed', 'declined'],
      default: 'pending',
    },
    signatureFields: [signatureFieldSchema],
    signedAt: { type: Date },
    signerIp: { type: String },
    userAgent: { type: String },
    signatureData: { type: String }, // e.g. data URL or text signature
  },
  { timestamps: true }
);

module.exports = mongoose.model('SignRequest', signRequestSchema);

