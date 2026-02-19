const path = require('path');
const fs = require('fs');
const { uploadDir } = require('../config/env');

function getDocumentPath(filename) {
  return path.join(uploadDir, filename);
}

function ensureUploadDir() {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
}

module.exports = {
  getDocumentPath,
  ensureUploadDir,
};

