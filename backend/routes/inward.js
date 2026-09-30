const router          = require('express').Router();
const Inward          = require('../models/Inward');
const Material        = require('../models/Material');
const PurchaseOrder   = require('../models/PurchaseOrder');
const PurchaseRequest = require('../models/PurchaseRequest');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { parsePagination, paginateQuery } = require('../utils/paginate');

// Allowed fields for create / full edit
const INWARD_FIELDS = [
  'date','invdate','challan','po','vendor',
  'name','type','code','category','uom',
  'qty','gin','by','location','remarks','price',
];

function pickFields(body, fields) {
  return fields.reduce((acc, f) => {
    if (f in body) acc[f] = body[f];
    return acc;
  }, {});
}

// ── Helper: after inward entries are saved, check if the linked PR
// should be auto-advanced to "received" (all PO items fully received).
async function checkAndReceivePR(poNumbers, byName, byUsername) {
  if (!poNumbers || !poNumbers.length) return;

  // Find all POs referenced by these inward entries
  const pos = await PurchaseOrder.find({ poNumber: { $in: poNumbers } }).lean();
  if (!pos.length) return;

  // Group POs by prId
  const prIdSet = [...new Set(pos.map(p => String(p.prId)).filter(Boolean))];

  for (const prId of prIdSet) {
    const pr = await PurchaseRequest.findById(prId);
    if (!pr || pr.status === 'received' || pr.status === 'rejected') continue;

    // Get all POs for this PR
    const allPRPos = await PurchaseOrder.find({ prId }).lean();
    if (!allPRPos.length) continue;

    // Sum total ordered qty per item across all POs
    const orderedMap = {};
    for (const po of allPRPos) {
      for (const it of (po.items || [])) {
        orderedMap[it.name] = (orderedMap[it.name] || 0) + (it.orderedQty || 0);
      }
    }

    // Sum total received qty per item across all inward entries linked to these POs
    const poNums = allPRPos.map(p => p.poNumber);
    const inwardDocs = await Inward.find({ po: { $in: poNums } }).lean();
    const receivedMap = {};
    for (const doc of inwardDocs) {
      if (!doc.po) continue;
      receivedMap[doc.name] = (receivedMap[doc.name] || 0) + (doc.qty || 0);
    }

    // Check if every ordered item is fully received
    const fullyReceived = Object.entries(orderedMap).every(([name, ordQty]) => {
      return (receivedMap[name] || 0) >= ordQty - 0.00001;
    });

    if (fullyReceived) {
      pr.status     = 'received';
      pr.receivedAt = new Date();
      pr.history.push({
        status: 'received',
        byName:     byName || 'System',
        byUsername: byUsername || 'system',
        note: 'Auto-marked received — all PO items inwarded.',
        at: new Date(),
      });
      await pr.save();
    }
  }
}

// GET /api/inward
// Optional ?page=&limit= → { items, total, page, limit }; otherwise full array.
router.get('/', authMiddleware, async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    const filter = {};
    if (String(req.query.unpriced || '') === '1') {
      filter.$or = [
        { price: { $exists: false } },
        { price: null },
        { price: 0 },
      ];
    }
    const result = await paginateQuery(Inward, filter, {
      sort: { createdAt: -1 },
      pagination,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const NAME_FIELDS = ['vendor', 'category'];

// Distinct vendor or category spellings, with how many inward rows use each.
router.get('/name-values', authMiddleware, requireRole('admin', 'purchase'), async (req, res) => {
  try {
    const field = String(req.query.field || '');
    if (!NAME_FIELDS.includes(field)) {
      return res.status(400).json({ error: 'Choose vendor or category.' });
    }
    const rows = await Inward.aggregate([
      { $match: { [field]: { $nin: [null, ''] } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]);
    res.json({
      field,
      values: rows
        .filter((row) => String(row._id || '').trim())
        .map((row) => ({ value: String(row._id), count: row.count || 0 })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Merge selected spellings into one name on inward rows.
// Category is also updated on the material master and purchase-order lines,
// and vendor on purchase orders, so the next entry does not bring the old spelling back.
router.post('/rename-names', authMiddleware, requireRole('admin', 'purchase'), async (req, res) => {
  try {
    const field = String(req.body.field || '');
    if (!NAME_FIELDS.includes(field)) {
      return res.status(400).json({ error: 'Choose vendor or category.' });
    }
    const to = String(req.body.to || '').trim().replace(/\s+/g, ' ');
    if (!to) return res.status(400).json({ error: 'Enter the name to use.' });

    const from = [...new Set(
      (Array.isArray(req.body.from) ? req.body.from : [])
        .map((value) => String(value ?? ''))
        .filter((value) => value.trim() && value !== to)
    )];
    if (!from.length) {
      return res.status(400).json({ error: 'Select at least one name to change.' });
    }
    if (from.length > 200) {
      return res.status(400).json({ error: 'Select fewer names at once.' });
    }

    const inwardResult = await Inward.updateMany(
      { [field]: { $in: from } },
      { $set: { [field]: to } }
    );

    let materialsUpdated = 0;
    let ordersUpdated = 0;
    if (field === 'category') {
      const materialResult = await Material.updateMany(
        { category: { $in: from } },
        { $set: { category: to } }
      );
      materialsUpdated = materialResult.modifiedCount || 0;
      const orderResult = await PurchaseOrder.updateMany(
        { 'items.category': { $in: from } },
        { $set: { 'items.$[line].category': to } },
        { arrayFilters: [{ 'line.category': { $in: from } }] }
      );
      ordersUpdated = orderResult.modifiedCount || 0;
    } else {
      const orderResult = await PurchaseOrder.updateMany(
        { vendorName: { $in: from } },
        { $set: { vendorName: to } }
      );
      ordersUpdated = orderResult.modifiedCount || 0;
    }

    res.json({
      updated: inwardResult.modifiedCount || 0,
      materialsUpdated,
      ordersUpdated,
      to,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/inward — single entry
router.post('/', authMiddleware, requireRole('admin','store','store_manager','purchase'), async (req, res) => {
  try {
    const data = pickFields(req.body, INWARD_FIELDS);
    if (!data.name)                             return res.status(400).json({ error: 'Material name is required.' });
    if (!data.qty || parseFloat(data.qty) <= 0) return res.status(400).json({ error: 'Valid quantity is required.' });
    if (!data.gin || !String(data.gin).trim())  return res.status(400).json({ error: 'GIN is required.' });
    data.qty   = parseFloat(data.qty);
    data.gin   = String(data.gin).trim();
    data.price = parseFloat(data.price) || 0;

    const entry = await Inward.create(data);

    // Check if PR should be auto-received
    if (data.po) {
      await checkAndReceivePR([data.po], req.user.name, req.user.username);
    }

    res.status(201).json(entry);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/inward/bulk
router.post('/bulk', authMiddleware, requireRole('admin','store','store_manager','purchase'), async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || !entries.length)
      return res.status(400).json({ error: 'No entries provided.' });

    const clean = entries.map(e => {
      const d = pickFields(e, INWARD_FIELDS);
      d.qty   = parseFloat(d.qty)   || 0;
      d.gin   = d.gin != null ? String(d.gin).trim() : '';
      d.price = parseFloat(d.price) || 0;
      return d;
    }).filter(d => d.name && d.qty > 0 && d.gin);

    if (!clean.length) return res.status(400).json({ error: 'No valid entries after validation.' });

    const docs = await Inward.insertMany(clean, { ordered: false });

    // Check PR auto-receive for all unique PO numbers in this batch
    const poNumbers = [...new Set(clean.map(d => d.po).filter(Boolean))];
    if (poNumbers.length) {
      await checkAndReceivePR(poNumbers, req.user.name, req.user.username);
    }

    res.status(201).json({ inserted: docs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/inward/:id — price update only (purchase team)
router.patch('/:id', authMiddleware, requireRole('admin','purchase'), async (req, res) => {
  try {
    const price = parseFloat(req.body.price);
    if (isNaN(price) || price < 0) return res.status(400).json({ error: 'Valid price is required.' });
    const doc = await Inward.findByIdAndUpdate(
      req.params.id, { $set: { price } }, { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found.' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/inward/:id — full edit (admin + store team)
router.put('/:id', authMiddleware, requireRole('admin','store','store_manager'), async (req, res) => {
  try {
    const data = pickFields(req.body, INWARD_FIELDS);
    if (data.qty   !== undefined) data.qty   = parseFloat(data.qty)   || 0;
    if (data.gin   !== undefined) {
      data.gin = String(data.gin || '').trim();
      if (!data.gin) return res.status(400).json({ error: 'GIN is required.' });
    }
    if (data.price !== undefined) data.price = parseFloat(data.price) || 0;
    const doc = await Inward.findByIdAndUpdate(
      req.params.id, { $set: data }, { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found.' });

    // Re-check PR auto-receive in case qty was increased
    if (doc.po) {
      await checkAndReceivePR([doc.po], req.user.name, req.user.username);
    }

    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/inward/:id
router.delete('/:id', authMiddleware, requireRole('admin','store','store_manager'), async (req, res) => {
  try {
    const doc = await Inward.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
