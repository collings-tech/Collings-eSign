// Env the app reads at import time. Placeholders only; nothing here is a secret.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret-not-for-real-use';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.UPLOAD_DIR = require('path').join(__dirname, 'tmp-uploads');
// Keep Supabase unset so the local-disk storage path (the one that used to be
// served publicly) is what gets exercised.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
