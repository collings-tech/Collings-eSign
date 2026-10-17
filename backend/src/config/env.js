const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

// The JWT signing key. There is deliberately no hard-coded fallback: a deploy
// that forgot the variable used to run on a published default value, which
// let anyone mint a valid session. In production a missing key is fatal; in
// development a random per-process key is generated so the app still starts
// but every restart logs everyone out (and nothing is predictable).
function resolveJwtSecret() {
  const fromEnv = (process.env.JWT_SECRET || '').trim();
  if (fromEnv) {
    if (fromEnv === 'dev_secret_change_me' || fromEnv === 'change_this_secret') {
      throw new Error('JWT_SECRET is set to a placeholder value. Generate a real secret (e.g. `openssl rand -hex 48`).');
    }
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not set. Refusing to start without a signing key.');
  }
  console.warn('[env] JWT_SECRET is not set; using a random per-process key. Sessions will not survive a restart.');
  return crypto.randomBytes(48).toString('hex');
}

module.exports = {
  port: process.env.PORT || 4000,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/docsign_app',
  jwtSecret: resolveJwtSecret(),
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  defaultAdminEmail: process.env.DEFAULT_ADMIN_EMAIL || '',
  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || '',
  defaultAdminName: process.env.DEFAULT_ADMIN_NAME || 'Default Admin',
  // Largest PDF accepted on upload. Uploads are buffered in memory, so this
  // bounds per-request memory too.
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 25 * 1024 * 1024,
};
