const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const User = require('../models/User');

async function authOptional(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  const token = authHeader.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, jwtSecret);
    const user = await User.findById(payload.sub).lean();
    if (user) {
      req.user = { id: user._id.toString(), email: user.email, name: user.name, profileImageUrl: user.profileImageUrl || null };
    }
  } catch (err) {
    // ignore invalid token
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function signToken(user) {
  const payload = {
    sub: user._id.toString(),
    email: user.email,
  };
  const token = jwt.sign(payload, jwtSecret, { expiresIn: '7d' });
  return token;
}

module.exports = {
  authOptional,
  requireAuth,
  signToken,
};

