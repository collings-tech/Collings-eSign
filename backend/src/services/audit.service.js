const AuditLog = require('../models/AuditLog');

async function logEvent({ documentId, signRequestId, actorType, actorIdOrEmail, eventType, meta }) {
  try {
    await AuditLog.create({
      documentId,
      signRequestId: signRequestId || undefined,
      actorType,
      actorIdOrEmail,
      eventType,
      meta: meta || {},
    });
  } catch (err) {
    console.error('Failed to write audit log', err);
  }
}

module.exports = {
  logEvent,
};

