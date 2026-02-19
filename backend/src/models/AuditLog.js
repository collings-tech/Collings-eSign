const { mongoose } = require('../db/mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
    signRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'SignRequest' },
    actorType: { type: String, enum: ['sender', 'signer', 'system'], required: true },
    actorIdOrEmail: { type: String, required: true },
    eventType: {
      type: String,
      enum: [
        'document_created',
        'sent_for_signature',
        'link_opened',
        'signed',
        'declined',
      ],
      required: true,
    },
    meta: { type: Object },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);

