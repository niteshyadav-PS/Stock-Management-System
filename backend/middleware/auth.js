const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    console.warn(`[authMiddleware] no token — ${req.method} ${req.originalUrl}`);
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    console.warn(`[authMiddleware] invalid/expired token — ${req.method} ${req.originalUrl} —`, err.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      console.warn(
        `[requireRole] denied — ${req.method} ${req.originalUrl} — ` +
        `role: ${JSON.stringify(req.user && req.user.role)} — allowed: ${JSON.stringify(roles)}`
      );
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };