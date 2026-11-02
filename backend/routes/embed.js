const router = require('express').Router();
const Material = require('../models/Material');
const { requireEmbedToken } = require('../middleware/embedAuth');
const { buildStockSummary } = require('./stock');

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// GET /api/embed/stock-summary
router.get('/stock-summary', requireEmbedToken, async (req, res) => {
  try {
    res.json(await buildStockSummary());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/embed/master — read-only material list for Live Stock display
router.get('/master', requireEmbedToken, async (req, res) => {
  try {
    const list = await Material.find({})
      .sort({ name: 1 })
      .select('name type code category uom minStock')
      .lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
