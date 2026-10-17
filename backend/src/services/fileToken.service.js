/**
 * Short-lived signed URLs for files kept on local disk (the fallback used when
 * Supabase storage is not configured).
 *
 * Document PDFs used to be served straight from `express.static(uploadDir)`:
 * anyone who learned a file name could download it with no login and no
 * ownership check. Local files are now served only through GET /files/:token,
 * where the token is an HMAC over the relative path and an expiry, so a URL
 * works for the viewer that requested it and then dies. This mirrors what the
 * Supabase signed-URL path already does, so both storage modes behave alike.
 */
const crypto = require('crypto');
const path = require('path');
const { jwtSecret } = require('../config/env');

const DEFAULT_TTL_SECONDS = 60 * 60;

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', jwtSecret).update(payload).digest('base64url');
}

/**
 * @param {string} relativePath path inside uploadDir, e.g. "1699-123.pdf"
 * @param {number} [ttlSeconds]
 * @returns {string} opaque token for /files/:token
 */
function createFileToken(relativePath, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const normalized = path.posix.normalize(String(relativePath).replace(/\\/g, '/'));
  if (!normalized || normalized.startsWith('..') || path.posix.isAbsolute(normalized)) {
    throw new Error('Invalid file path');
  }
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
  const payload = `${b64url(normalized)}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * @returns {{ relativePath: string } | null} null when malformed, tampered or expired
 */
function verifyFileToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [p, expStr, sig] = parts;
  const payload = `${p}.${expStr}`;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  let relativePath;
  try {
    relativePath = Buffer.from(p, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const normalized = path.posix.normalize(relativePath);
  if (!normalized || normalized.startsWith('..') || path.posix.isAbsolute(normalized)) return null;
  return { relativePath: normalized };
}

function fileUrl(baseUrl, relativePath, ttlSeconds) {
  return `${baseUrl.replace(/\/+$/, '')}/files/${createFileToken(relativePath, ttlSeconds)}`;
}

module.exports = { createFileToken, verifyFileToken, fileUrl, DEFAULT_TTL_SECONDS };
