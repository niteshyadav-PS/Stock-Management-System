'use strict';
require('dotenv').config();

const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const cors     = require('cors');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Behind Hostinger/Render/Netlify the app sees the proxy's IP unless this is set,
// which would make the login rate limiter throttle every user as one client.
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────────────
// Read allowed origin from .env — supports comma-separated list for multiple origins
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    const err = new Error(`CORS: origin ${origin} not allowed`);
    err.status = 403;
    callback(err);
  },
  credentials: true,
}));

// ── Body parser ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ── Chrome DevTools well-known route (silences 404 in console) ───────────────
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.json({ version: '1.0', type: 'node' });
});

// ── Favicon silencer ─────────────────────────────────────────────────────────
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ── Rate limiter — login endpoint ─────────────────────────────────────────────
const rateLimit = require('express-rate-limit');
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,  // 5 minutes
  max: 5,                     // 5 attempts per IP per window
  message: { error: 'Too many login attempts. Please try again in 5 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', loginLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ message: 'Stockyard API is running' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/master',  require('./routes/master'));
app.use('/api/inward',  require('./routes/inward'));
app.use('/api/outward', require('./routes/outward'));
app.use('/api/users',   require('./routes/users'));
app.use('/api/purchase-requests', require('./routes/purchaseRequests'));
app.use('/api/purchase-orders',   require('./routes/purchaseOrders'));
app.use('/api/job-orders', require('./routes/jobOrders'));

// ── 404 handler for unknown routes ───────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error('[ERROR]', status, err.message);
  // Unexpected failures can carry stack traces or driver details, so only the
  // message of a deliberate 4xx is safe to return to the client.
  res.status(status).json({
    error: status < 500 ? err.message : 'Internal server error',
  });
});

// ── Seed default admin ────────────────────────────────────────────────────────
// Only runs when the user collection is empty. The old build hardcoded the
// password, which is public in the repo history — in production the seed now
// refuses to run unless SEED_ADMIN_PASSWORD is supplied.
async function seedAdmin() {
  const User = require('./models/User');
  if (await User.countDocuments() > 0) return;

  const password = process.env.SEED_ADMIN_PASSWORD || (isProd ? null : 'admin@2026');
  if (!password) {
    console.warn('  ! No users exist and SEED_ADMIN_PASSWORD is unset — skipping admin seed.');
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await User.create({ name: 'Administrator', username: 'admin', password: hash, role: 'admin' });
  console.log(`  ✓ Seeded admin user  →  username: admin${isProd ? '' : `  |  password: ${password}`}`);
}

// ── Connect + Start ───────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✓ MongoDB connected');
    await seedAdmin();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`✓ Stock Management System → http://localhost:${PORT}`);
      console.log(`✓ CORS allowed  → ${allowedOrigins.join(', ')}`);
      console.log(`✓ Environment   → ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch(err => {
    console.error('✗ MongoDB connection failed:', err.message);
    process.exit(1);
  });
