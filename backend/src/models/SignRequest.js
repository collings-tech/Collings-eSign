const { mongoose } = require('../db/mongoose');

const signatureFieldSchema = new mongoose.Schema(
  {
    id: { type: String },
    page: { type: Number, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    /** Percent-based coords (preferred): % of page width/height, survives zoom/resize. */
    xPct: { type: Number },
    yPct: { type: Number },
    wPct: { type: Number },
    hPct: { type: Number },
    type: { type: String, enum: ['signature', 'initial', 'text', 'date', 'name', 'email', 'stamp', 'company', 'title', 'number', 'checkbox', 'dropdown', 'radio', 'note', 'approve', 'decline'], default: 'signature' },
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
    /** Checkbox: label text next to checkbox (DocuSign caption) */
    caption: { type: String, default: undefined },
    /** Checkbox: default checked state */
    checked: { type: Boolean, default: false },
    /** Number: min value, max value, decimal places, placeholder */
    minValue: { type: Number, default: undefined },
    maxValue: { type: Number, default: undefined },
    decimalPlaces: { type: Number, default: 0 },
    placeholder: { type: String, default: undefined },
    /** Default value for Name, Email, Company, Title, Text, Number fields */
    defaultValue: { type: String, default: undefined },
    /** Radio: group name to link multiple radio buttons (DocuSign RadioGroup) */
    groupName: { type: String, default: undefined },
    /** Note: sender's message to recipient (not written on document) */
    noteContent: { type: String, default: undefined },
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
    /** Set when recipient clicks Approve (DocuSign-style approve field); allows completion without signing. */
    approvedAt: { type: Date },
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

