const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { connectMongo } = require('./db/mongoose');
const { port, uploadDir, clientOrigin, defaultAdminEmail, defaultAdminPassword, defaultAdminName } = require('./config/env');
const { authOptional } = require('./middleware/auth');
const User = require('./models/User');
const authRoutes = require('./routes/auth.routes');
const documentsRoutes = require('./routes/documents.routes');
const signRequestsRoutes = require('./routes/signRequests.routes');
const signingRoutes = require('./routes/signing.routes');
const signupRequestsRoutes = require('./routes/signupRequests.routes');
const usersRoutes = require('./routes/users.routes');
const filesRoutes = require('./routes/files.routes');

const app = express();

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(
  cors({
    origin: clientOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(authOptional);

// Only profile photos are served as plain static files: they are shown with
// <img> tags that cannot carry a bearer token, and they are not sensitive.
// Document PDFs were previously served from the whole upload directory with no
// authentication; they now go through /files/:token (signed, expiring) or the
// authenticated /documents and token-scoped /signing routes.
app.use('/uploads/profiles', express.static(path.join(uploadDir, 'profiles'), {
  dotfiles: 'deny',
  index: false,
  setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); },
}));
app.use('/files', filesRoutes);

// Routes
app.use('/auth', authRoutes);
app.use('/documents', documentsRoutes);
app.use('/sign-requests', signRequestsRoutes);
app.use('/signing', signingRoutes);
app.use('/user-requests', signupRequestsRoutes);
app.use('/users', usersRoutes);

// Basic healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

async function seedDefaultAdmin() {
  if (!defaultAdminEmail || !defaultAdminPassword) {
    console.log('DEFAULT_ADMIN_EMAIL or DEFAULT_ADMIN_PASSWORD not set — skipping admin seed.');
    return;
  }

  const adminCount = await User.countDocuments({ roles: 'admin' });
  if (adminCount > 0) {
    console.log(`Admin seed skipped — ${adminCount} admin user(s) already exist.`);
    return;
  }

  const passwordHash = await bcrypt.hash(defaultAdminPassword, 10);
  await User.create({
    email: defaultAdminEmail,
    passwordHash,
    name: defaultAdminName,
    roles: ['admin'],
  });

  console.log(`Default admin created: ${defaultAdminEmail}`);
}

async function start() {
  try {
    await connectMongo();
    await seedDefaultAdmin();
    app.listen(port, () => {
      console.log(`Backend listening on port ${port}`);
    });
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
}

start();

