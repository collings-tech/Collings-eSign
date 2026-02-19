const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { connectMongo } = require('./db/mongoose');
const { port, uploadDir, clientOrigin } = require('./config/env');
const { authOptional } = require('./middleware/auth');
const authRoutes = require('./routes/auth.routes');
const documentsRoutes = require('./routes/documents.routes');
const signRequestsRoutes = require('./routes/signRequests.routes');
const signingRoutes = require('./routes/signing.routes');

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

// Basic healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// TODO: mount routes (auth, documents, signRequests, signing)

async function start() {
  try {
    await connectMongo();
    app.listen(port, () => {
      console.log(`Backend listening on port ${port}`);
    });
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
}

start();

