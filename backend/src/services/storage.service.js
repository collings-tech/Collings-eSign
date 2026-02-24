/**
 * Supabase Storage for document PDFs.
 * Bucket layout: documents/{docId}/original.pdf, documents/{docId}/signed.pdf
 * MongoDB holds the keys (originalKey, signedKey); we never rename files on storage.
 */
const { createClient } = require('@supabase/supabase-js');

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'documents';
const SIGNED_URL_EXPIRY_SECONDS = 5 * 60; // 5 minutes (default for backward compatibility)
/** For document links sent in emails (e.g. signing link flow) */
const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;
/** For in-app document URLs (thumbnails, detail view, dashboard) */
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are required for storage');
  }
  return createClient(url, key);
}

function isStorageConfigured() {
  return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
}

/**
 * Upload a buffer to storage at the given key.
 * @param {string} key - e.g. "documents/23408874012413/original.pdf"
 * @param {Buffer} buffer
 * @returns {Promise<{ key: string }>}
 */
async function upload(key, buffer) {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(key, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return { key: data.path };
}

/**
 * Download file from storage to a Buffer.
 * @param {string} key - storage key
 * @returns {Promise<Buffer>}
 */
async function download(key) {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Create a signed URL for viewing/downloading (expires in 5 mins by default).
 * @param {string} key - storage key
 * @param {number} [expiresInSeconds=300]
 * @returns {Promise<string>} signed URL
 */
async function getSignedUrl(key, expiresInSeconds = SIGNED_URL_EXPIRY_SECONDS) {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(key, expiresInSeconds);
  if (error) throw new Error(`Storage signed URL failed: ${error.message}`);
  return data.signedUrl;
}

/**
 * Build storage key for original PDF (do not upload with a different name; use this key).
 */
function originalKey(docId) {
  return `documents/${docId}/original.pdf`;
}

/**
 * Build storage key for signed PDF.
 */
function signedKey(docId) {
  return `documents/${docId}/signed.pdf`;
}

module.exports = {
  isStorageConfigured,
  upload,
  download,
  getSignedUrl,
  originalKey,
  signedKey,
  BUCKET,
  SIGNED_URL_EXPIRY_SECONDS,
  ONE_WEEK_SECONDS,
  ONE_YEAR_SECONDS,
};
