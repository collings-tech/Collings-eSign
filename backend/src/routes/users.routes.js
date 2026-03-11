const express = require('express');
const User = require('../models/User');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Admin: list all users
router.get('/', requireAdmin, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.id } })
      .select('_id email name roles createdAt updatedAt profileImageUrl role')
      .sort({ createdAt: -1 })
      .lean();

    res.json(
      users.map((u) => ({
        id: u._id.toString(),
        email: u.email,
        name: u.name,
        roles: Array.isArray(u.roles) && u.roles.length ? u.roles : (u.role ? [u.role] : ['user']),
        profileImageUrl: u.profileImageUrl || null,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: update a user (currently roles and name)
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { setAdmin, name } = req.body || {};

    const update = {};
    if (name !== undefined) {
      const trimmed = String(name || '').trim();
      if (!trimmed) return res.status(400).json({ error: 'Name is required' });
      update.name = trimmed;
    }

    const shouldChangeAdmin = setAdmin !== undefined;
    if (!Object.keys(update).length && !shouldChangeAdmin) {
      return res.status(400).json({ error: 'No changes provided' });
    }

    // Prevent admin from removing their own admin role
    if (setAdmin === false && req.user?.id && String(req.user.id) === String(id)) {
      return res.status(400).json({ error: 'You cannot remove your own admin role' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (Object.keys(update).length) {
      Object.assign(user, update);
    }

    if (shouldChangeAdmin) {
      const currentRoles = Array.isArray(user.roles) && user.roles.length
        ? user.roles
        : (user.role ? [user.role] : ['user']); // backward compat
      const normalized = Array.from(new Set(currentRoles.map((r) => String(r || '').trim()).filter(Boolean)));
      if (!normalized.includes('user')) normalized.push('user');
      if (setAdmin) {
        if (!normalized.includes('admin')) normalized.push('admin');
      } else {
        user.roles = normalized.filter((r) => r !== 'admin');
      }
      if (setAdmin) user.roles = normalized;
    }

    if (!Array.isArray(user.roles) || user.roles.length === 0) user.roles = ['user'];
    if (!user.roles.includes('user')) user.roles.push('user');

    await user.save();
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        roles: user.roles || ['user'],
        profileImageUrl: user.profileImageUrl || null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

