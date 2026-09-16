const router = require('express').Router();
const bcrypt = require('bcryptjs');
const User   = require('../models/User');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { parsePagination } = require('../utils/paginate');

// GET /api/users — returns plainPassword too (admin only)
// Optional ?page=&limit= → { items, total, page, limit }; otherwise full array.
router.get('/', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (!pagination) {
      const list = await User.find().select('-password').lean();
      return res.json(list);
    }
    const { page, limit, skip } = pagination;
    const [items, total] = await Promise.all([
      User.find().select('-password').skip(skip).limit(limit).lean(),
      User.countDocuments(),
    ]);
    res.json({ items, total, page, limit });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/users — create or update, stores plainPassword
router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password)
      return res.status(400).json({ error: 'name, username and password are required' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.findOneAndUpdate(
      { username: username.toLowerCase().trim() },
      { $set: { name: name.trim(), password: hash, plainPassword: password, role } },
      { upsert: true, new: true }
    );
    res.status(201).json({ name: user.name, username: user.username, role: user.role, plainPassword: user.plainPassword });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/users/:username/password — record plain password for existing user
router.patch('/:username/password', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { plainPassword, newPassword } = req.body;
    if (!plainPassword) return res.status(400).json({ error: 'plainPassword is required' });
    const update = { plainPassword };
    if (newPassword) {
      update.password = await bcrypt.hash(newPassword, 10);
    }
    const user = await User.findOneAndUpdate(
      { username: req.params.username },
      { $set: update },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, plainPassword: user.plainPassword });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/users/:username
router.delete('/:username', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    if (req.params.username === req.user.username)
      return res.status(400).json({ error: "Cannot delete your own account" });
    await User.findOneAndDelete({ username: req.params.username });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
