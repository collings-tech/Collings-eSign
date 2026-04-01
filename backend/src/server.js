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

// Static files for uploaded documents
app.use('/uploads', express.static(uploadDir));

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

// TODO: mount routes (auth, documents, signRequests, signing)

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

