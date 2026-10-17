const express = require('express');
const path = require('path');
const fs = require('fs');
const { uploadDir } = require('../config/env');
const { verifyFileToken } = require('../services/fileToken.service');

const router = express.Router();

// Serve a locally stored document through a signed, expiring token (see
// fileToken.service). Replaces the open `express.static(uploadDir)` mount.
router.get('/:token', (req, res) => {
  const verified = verifyFileToken(req.params.token);
  if (!verified) {
    return res.status(403).json({ error: 'This file link is invalid or has expired.' });
  }
  const root = path.resolve(uploadDir);
  const fullPath = path.resolve(root, verified.relativePath);
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Cache-Control', 'private, no-store');
    // Pass the path relative to `root` so the dotfiles rule applies to the
    // file's own segments, not to the upload directory's absolute path.
    res.sendFile(verified.relativePath, { root, dotfiles: 'deny' });
  });
});

module.exports = router;
