const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  port: process.env.PORT || 4000,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/docsign_app',
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_me',
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
};

