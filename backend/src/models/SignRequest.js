const { mongoose } = require('../db/mongoose');

const signatureFieldSchema = new mongoose.Schema(
  {
    id: { type: String },
    page: { type: Number, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    type: { type: String, enum: ['signature', 'initial', 'text', 'date', 'name', 'email', 'stamp', 'company', 'title', 'number', 'checkbox', 'dropdown', 'radio'], default: 'signature' },
    required: { type: Boolean, default: true },
    dataLabel: { type: String, default: '' },
    tooltip: { type: String, default: '' },
    scale: { type: Number, default: 100 },
    /** Dropdown/Radio: [{ label: string, value: string }] */
    options: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    /** Dropdown/Radio: default selected value (empty = "-- Select --") */
    defaultOption: { type: String, default: '' },
    /** Name field: "Full Name" | "First Name" | "Last Name" */
    nameFormat: { type: String, default: undefined },
    readOnly: { type: Boolean, default: false },
    fontFamily: { type: String, default: undefined },
    fontSize: { type: Number, default: undefined },
    bold: { type: Boolean, default: false },
    italic: { type: Boolean, default: false },
    underline: { type: Boolean, default: false },
    fontColor: { type: String, default: undefined },
    addText: { type: String, default: undefined },
    characterLimit: { type: Number, default: undefined },
    hideWithAsterisks: { type: Boolean, default: false },
    fixedWidth: { type: Boolean, default: false },
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
    signatureData: { type: String }, // legacy: single signature applied to all fields
    /** Per-field signature data: { [fieldId]: signatureData }. When set, each signature/initial field is signed individually. */
    fieldSignatureData: { type: mongoose.Schema.Types.Mixed, default: undefined },
    /** Typed values for name/email/company/title/text/number fields: { [fieldId]: string }. */
    fieldValues: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SignRequest', signRequestSchema);

