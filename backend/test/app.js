// A test instance of the Express app without the listener / Mongo connect /
// admin seed that server.js runs at import. Mirrors server.js's middleware
// and mounts so route-level behaviour is what is under test.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { uploadDir } = require('../src/config/env');
const { authOptional } = require('../src/middleware/auth');

function buildApp() {
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(authOptional);
  app.use('/uploads/profiles', express.static(path.join(uploadDir, 'profiles'), { dotfiles: 'deny', index: false }));
  app.use('/files', require('../src/routes/files.routes'));
  app.use('/auth', require('../src/routes/auth.routes'));
  app.use('/documents', require('../src/routes/documents.routes'));
  app.use('/sign-requests', require('../src/routes/signRequests.routes'));
  app.use('/signing', require('../src/routes/signing.routes'));
  return app;
}

module.exports = { buildApp };
