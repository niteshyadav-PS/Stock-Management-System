const router = require('express').Router();
const InwardVendor = require('../models/InwardVendor');
const SEED_NAMES = require('../data/inwardVendorSeed');
const { authMiddleware, requireRole } = require('../middleware/auth');

const WRITE_ROLES = ['admin', 'purchase'];
const READ_ROLES = [
  'admin',
  'purchase',
  'store',
  'store_manager',
  'viewer',
];

async function ensureSeeded() {
  const count = await InwardVendor.countDocuments();
  if (count > 0) return;
  const seen = new Set();
  const docs = [];
  for (const raw of SEED_NAMES) {
    const name = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    docs.push({ name, address: '', active: true });
  }
  if (docs.length) await InwardVendor.insertMany(docs);
}

// GET /api/inward-vendors?active=true|false|all&q=
router.get('/', authMiddleware, requireRole(...READ_ROLES), async (req, res) => {
  try {
    await ensureSeeded();
    const filter = {};
    const active = String(req.query.active || 'true').trim().toLowerCase();
    if (active === 'true') filter.active = true;
    else if (active === 'false') filter.active = false;

    const q = String(req.query.q || '').trim();
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { address: { $regex: q, $options: 'i' } },
      ];
    }

    const list = await InwardVendor.find(filter).sort({ name: 1 }).lean();
    res.json(list);
  } catch (err) {
    console.error('[inward-vendors GET /] ', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inward-vendors
router.post('/', authMiddleware, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    const address = String(req.body.address || '').trim();
    const active = req.body.active === false ? false : true;
    if (!name) return res.status(400).json({ error: 'Vendor name is required.' });

    const created = await InwardVendor.create({ name, address, active });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This vendor already exists.' });
    }
    console.error('[inward-vendors POST /] ', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/inward-vendors/:id
router.put('/:id', authMiddleware, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    const address = String(req.body.address || '').trim();
    const active = req.body.active === false ? false : true;
    if (!name) return res.status(400).json({ error: 'Vendor name is required.' });

    const updated = await InwardVendor.findByIdAndUpdate(
      req.params.id,
      { $set: { name, address, active } },
      { new: true, runValidators: true },
    );
    if (!updated) return res.status(404).json({ error: 'Vendor not found.' });
    res.json(updated);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This vendor already exists.' });
    }
    console.error('[inward-vendors PUT /:id] ', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — soft deactivate; ?hard=1 removes
router.delete(
  '/:id',
  authMiddleware,
  requireRole(...WRITE_ROLES),
  async (req, res) => {
    try {
      if (String(req.query.hard || '') === '1') {
        await InwardVendor.findByIdAndDelete(req.params.id);
        return res.json({ ok: true, removed: true });
      }
      const updated = await InwardVendor.findByIdAndUpdate(
        req.params.id,
        { $set: { active: false } },
        { new: true },
      );
      if (!updated) return res.status(404).json({ error: 'Vendor not found.' });
      res.json(updated);
    } catch (err) {
      console.error('[inward-vendors DELETE /:id] ', err);
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
