const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'Incorrect username or password' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Incorrect username or password' });

    const token = jwt.sign(
      { id: user._id, username: user.username, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, user: { name: user.name, username: user.username, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
