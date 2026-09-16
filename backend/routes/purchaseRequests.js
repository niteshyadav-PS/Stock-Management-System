const router = require('express').Router();
const PurchaseRequest = require('../models/PurchaseRequest');
const { nextSeq } = require('../models/Counter');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { parsePagination, paginateQuery } = require('../utils/paginate');

// Roles that can raise a Purchase Request
const CREATOR_ROLES = ['admin', 'store', 'store_manager', 'viewer'];
// Roles that can approve / reject / progress a Purchase Request
const APPROVER_ROLES = ['admin', 'store_manager'];
// Roles that can set/edit reference pricing on a PR's items
const PRICING_ROLES = ['admin', 'purchase'];

// Valid lifecycle transitions
const TRANSITIONS = {
  pending:  ['approved', 'rejected'],
  approved: ['ordered', 'rejected'],  // ordered now driven by PO creation
  partial:  ['ordered', 'rejected'],  // partial → ordered when fully covered
  ordered:  ['received'],
  rejected: [],
  received: [],
};

function sanitizeItems(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const clean = [];
  for (const it of items) {
    if (!it || !it.name || !String(it.name).trim()) continue;
    const qty = parseFloat(it.qty);
    if (!qty || qty <= 0) continue;
    clean.push({
      name: String(it.name).trim(),
      type: it.type || '',
      code: it.code || '',
      category: it.category || '',
      uom: it.uom || '',
      qty,
      expectedDeliveryDate: it.expectedDeliveryDate || '',
      projectName: it.projectName || '',
      remarks: it.remarks || '',
    });
  }
  return clean.length ? clean : null;
}

// Roles that can see ALL requests (not just their own)
const VIEWER_ROLES = ['admin', 'purchase', 'store_manager', 'store', 'viewer'];

// GET /api/purchase-requests
// Admin / purchase / store_manager / store see all requests. viewer sees only their own.
// Optional ?page=&limit= → { items, total, page, limit }; otherwise full array.
router.get('/', authMiddleware, async (req, res) => {
  try {
    const canViewAll = VIEWER_ROLES.includes(req.user.role);
    console.log(`[GET LIST] role=${JSON.stringify(req.user.role)} canViewAll=${canViewAll}`);
    const filter = canViewAll ? {} : { requestedByUsername: req.user.username };
    const pagination = parsePagination(req.query);
    const result = await paginateQuery(PurchaseRequest, filter, {
      sort: { createdAt: -1 },
      pagination,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/purchase-requests — create a new PR (Store team)
router.post('/', authMiddleware, requireRole(...CREATOR_ROLES), async (req, res) => {
  try {
    const items = sanitizeItems(req.body.items);
    if (!items) return res.status(400).json({ error: 'At least one valid line item (material + qty) is required.' });

    const seq = await nextSeq('purchaseRequest');
    const prNumber = `PR-${String(seq).padStart(4, '0')}`;

    const pr = await PurchaseRequest.create({
      prNumber,
      date: req.body.date || new Date().toISOString().slice(0, 10),
      projectName: req.body.projectName || '',
      requestFrom: req.body.requestFrom || '',
      requestedByName: req.user.name,
      requestedByUsername: req.user.username,
      items,
      remarks: req.body.remarks || '',
      status: 'pending',
      history: [{
        status: 'pending', byName: req.user.name, byUsername: req.user.username,
        note: 'Request raised', at: new Date(),
      }],
    });
    res.status(201).json(pr);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'PR number collision — please retry.' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/purchase-requests/:id — edit a request (only while pending, by its owner or admin)
router.put('/:id', authMiddleware, requireRole(...CREATOR_ROLES), async (req, res) => {
  try {
    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ error: 'Not found' });
    const isOwner = pr.requestedByUsername === req.user.username;
   if (!isOwner && req.user.role !== 'admin' && req.user.role !== 'store_manager')
  return res.status(403).json({ error: 'You can only edit your own requests.' });
    if (pr.status !== 'pending')
      return res.status(400).json({ error: `Cannot edit a request that is already ${pr.status}.` });

    const items = sanitizeItems(req.body.items);
    if (!items) return res.status(400).json({ error: 'At least one valid line item (material + qty) is required.' });

    pr.items = items;
    pr.remarks = req.body.remarks || '';
    pr.projectName = req.body.projectName || '';
    pr.requestFrom = req.body.requestFrom || '';
    if (req.body.date) pr.date = req.body.date;
    await pr.save();
    res.json(pr);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/purchase-requests/:id/item-prices — save reference prices against this
// PR's items, keyed by item name. Does not touch qty/status/anything else.
// Body: { items: [{ name, price }, ...] }
router.patch('/:id/item-prices', authMiddleware, requireRole(...PRICING_ROLES), async (req, res) => {
  try {
    const incoming = Array.isArray(req.body.items) ? req.body.items : null;
    if (!incoming || !incoming.length)
      return res.status(400).json({ error: 'items[] with { name, price } is required.' });

    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ error: 'Not found' });

    const priceByName = {};
    for (const it of incoming) {
      const name = String(it?.name || '').trim();
      if (!name) continue;
      const price = parseFloat(it.price);
      priceByName[name] = isNaN(price) || price < 0 ? 0 : price;
    }

    let touched = 0;
    pr.items.forEach(it => {
      if (Object.prototype.hasOwnProperty.call(priceByName, it.name)) {
        it.price = priceByName[it.name];
        touched++;
      }
    });

    if (!touched)
      return res.status(400).json({ error: 'None of the given item names matched this PR.' });

    await pr.save();
    res.json(pr);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/purchase-requests/:id — cancel a request (only while pending, by its owner or admin)
router.delete('/:id', authMiddleware, requireRole(...CREATOR_ROLES), async (req, res) => {
  try {
    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ error: 'Not found' });
    const isOwner = pr.requestedByUsername === req.user.username;
    if (!isOwner && req.user.role !== 'admin')
      return res.status(403).json({ error: 'You can only cancel your own requests.' });
    if (pr.status !== 'pending')
      return res.status(400).json({ error: `Cannot cancel a request that is already ${pr.status}.` });

    await PurchaseRequest.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/purchase-requests/:id/status — move a request through its lifecycle
// (Purchase team / admin only)
router.patch('/:id/status', authMiddleware, requireRole(...APPROVER_ROLES), async (req, res) => {
  try {
    const { status, note, poNumber, vendor } = req.body;
    const pr = await PurchaseRequest.findById(req.params.id);
    if (!pr) return res.status(404).json({ error: 'Not found' });

    const allowed = TRANSITIONS[pr.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Cannot move a request from "${pr.status}" to "${status}".` });
    }

    pr.status = status;
    if (status === 'approved') {
      pr.approvedByName = req.user.name;
      pr.approvedAt = new Date();
    }
    if (status === 'rejected') {
      pr.rejectReason = note || '';
    }
    if (status === 'ordered') {
      pr.poNumber = poNumber || '';
      pr.vendor = vendor || '';
      pr.orderedAt = new Date();
    }
    if (status === 'received') {
      pr.receivedAt = new Date();
    }

    pr.history.push({
      status, byName: req.user.name, byUsername: req.user.username,
      note: note || '', at: new Date(),
    });

    await pr.save();
    res.json(pr);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;