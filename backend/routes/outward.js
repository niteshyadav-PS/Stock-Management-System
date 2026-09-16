const router  = require('express').Router();
const Outward = require('../models/Outward');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { parsePagination, paginateQuery } = require('../utils/paginate');

const OUTWARD_EDIT_ROLES = ['admin', 'store', 'store_manager'];

function normalizeOutwardPayload(entry) {
  if (!entry || typeof entry !== 'object') return { reqty: null };
  const reqtyRaw =
    entry.reqty ??
    entry.reqQty ??
    entry.requiredQty ??
    entry.requiredqty ??
    entry.reqqty ??
    null;
  const reqty = reqtyRaw === '' ? null : Number(reqtyRaw);
  return { ...entry, reqty: Number.isFinite(reqty) ? reqty : null };
}

function normalizeOutwardResponse(entry) {
  const normalized = normalizeOutwardPayload(entry);
  return { ...entry, reqty: normalized.reqty };
}

// GET /api/outward
// Optional ?page=&limit= → { items, total, page, limit }; otherwise full array.
router.get('/', authMiddleware, async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    const result = await paginateQuery(Outward, {}, {
      sort: { createdAt: -1 },
      pagination,
    });
    if (Array.isArray(result)) {
      return res.json(result.map(normalizeOutwardResponse));
    }
    res.json({
      ...result,
      items: result.items.map(normalizeOutwardResponse),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/outward — single
router.post('/', authMiddleware, requireRole(...OUTWARD_EDIT_ROLES), async (req, res) => {
  try {
    const entry = await Outward.create(normalizeOutwardPayload(req.body));
    res.status(201).json(normalizeOutwardResponse(entry.toObject()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/outward/bulk
router.post('/bulk', authMiddleware, requireRole(...OUTWARD_EDIT_ROLES), async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || !entries.length)
      return res.status(400).json({ error: 'No entries provided' });
    const docs = await Outward.insertMany(entries.map(normalizeOutwardPayload), { ordered: false });
    res.status(201).json({ inserted: docs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/outward/:id — full edit (admin + store in/out team)
router.put('/:id', authMiddleware, requireRole(...OUTWARD_EDIT_ROLES), async (req, res) => {
  try {
    const doc = await Outward.findByIdAndUpdate(
      req.params.id,
      { $set: normalizeOutwardPayload(req.body) },
      { new: true },
    );
    if (!doc) return res.status(404).json({ error: 'Not found.' });
    res.json(normalizeOutwardResponse(doc.toObject()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/outward/:id (admin + store in/out team)
router.delete('/:id', authMiddleware, requireRole(...OUTWARD_EDIT_ROLES), async (req, res) => {
  try {
    const doc = await Outward.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
