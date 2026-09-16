'use strict';
require('dotenv').config();

const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const cors     = require('cors');

const app = express();

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
    callback(new Error(`CORS: origin ${origin} not allowed`));
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
  windowMs: 5 * 60 * 1000,  // 15 minutes
  max: 5,                     // 20 attempts per IP per window
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
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Seed default admin ────────────────────────────────────────────────────────
async function seedAdmin() {
  const User = require('./models/User');
  const count = await User.countDocuments();
  if (count === 0) {
    const hash = await bcrypt.hash('admin@2026', 10);
    await User.create({ name: 'Administrator', username: 'admin', password: hash, role: 'admin' });
    console.log('  ✓ Seeded admin user  →  username: admin  |  password: admin@2026');
  }
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
