const router = require('express').Router();
const Inward = require('../models/Inward');
const Outward = require('../models/Outward');
const { authMiddleware } = require('../middleware/auth');

const nameKey = {
  $toLower: { $trim: { input: { $ifNull: ['$name', ''] } } },
};

function isoDaysAgo(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Totals grouped by material. A few hundred rows instead of every transaction.
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const since = isoDaysAgo(13);
    const [inGroups, outGroups, pendingPriceCount, trendGroups] = await Promise.all([
      Inward.aggregate([
        { $match: { name: { $nin: [null, ''] } } },
        {
          $group: {
            _id: nameKey,
            name: { $first: '$name' },
            inQty: { $sum: { $ifNull: ['$qty', 0] } },
            inValue: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$qty', 0] },
                  { $ifNull: ['$price', 0] },
                ],
              },
            },
            count: { $sum: 1 },
          },
        },
      ]).option({ maxTimeMS: 20000 }),
      Outward.aggregate([
        { $match: { name: { $nin: [null, ''] } } },
        {
          $group: {
            _id: nameKey,
            name: { $first: '$name' },
            outQty: { $sum: { $ifNull: ['$qty', 0] } },
            count: { $sum: 1 },
          },
        },
      ]).option({ maxTimeMS: 20000 }),
      Inward.countDocuments({
        $or: [{ price: { $exists: false } }, { price: null }, { price: 0 }],
      }),
      Inward.aggregate([
        { $match: { date: { $gte: since } } },
        { $group: { _id: '$date', qty: { $sum: { $ifNull: ['$qty', 0] } } } },
      ]).option({ maxTimeMS: 20000 }),
    ]);

    const byKey = new Map();
    let inQty = 0;
    let outQty = 0;
    let inValue = 0;
    let inwardCount = 0;
    let outwardCount = 0;

    for (const row of inGroups) {
      const key = row._id || '';
      if (!key) continue;
      byKey.set(key, {
        key,
        name: row.name || key,
        inQty: row.inQty || 0,
        outQty: 0,
        inValue: row.inValue || 0,
      });
      inQty += row.inQty || 0;
      inValue += row.inValue || 0;
      inwardCount += row.count || 0;
    }
    for (const row of outGroups) {
      const key = row._id || '';
      if (!key) continue;
      const prev = byKey.get(key) || {
        key,
        name: row.name || key,
        inQty: 0,
        outQty: 0,
        inValue: 0,
      };
      prev.outQty = row.outQty || 0;
      if (!prev.name) prev.name = row.name || key;
      byKey.set(key, prev);
      outQty += row.outQty || 0;
      outwardCount += row.count || 0;
    }

    const trendMap = new Map(trendGroups.map((t) => [t._id, t.qty || 0]));
    const trend = [];
    for (let i = 13; i >= 0; i -= 1) {
      const date = isoDaysAgo(i);
      trend.push({ date, qty: trendMap.get(date) || 0 });
    }

    res.json({
      totals: {
        inQty,
        outQty,
        inValue,
        inwardCount,
        outwardCount,
        pendingPriceCount: pendingPriceCount || 0,
      },
      items: [...byKey.values()],
      trend,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Received qty keyed by "PO number||material name" for purchase-request status.
router.get('/received-by-po', authMiddleware, async (req, res) => {
  try {
    const rows = await Inward.aggregate([
      { $match: { po: { $nin: [null, ''] } } },
      {
        $group: {
          _id: { po: '$po', name: '$name' },
          qty: { $sum: { $ifNull: ['$qty', 0] } },
        },
      },
    ]).option({ maxTimeMS: 20000 });

    const byKey = {};
    for (const row of rows) {
      const po = row._id && row._id.po;
      const name = row._id && row._id.name;
      if (!po || !name) continue;
      byKey[`${po}||${name}`] = row.qty || 0;
    }
    res.json({ byKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
