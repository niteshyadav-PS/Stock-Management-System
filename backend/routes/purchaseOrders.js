const router          = require('express').Router();
const PurchaseOrder   = require('../models/PurchaseOrder');
const PurchaseRequest = require('../models/PurchaseRequest');
const Inward          = require('../models/Inward');
const { Counter, nextSeq } = require('../models/Counter');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { parsePagination, paginateQuery } = require('../utils/paginate');

const ALLOWED_ROLES = ['admin', 'purchase'];

// ── Shared helpers ────────────────────────────────────────────────────────────

// Same material can appear on a PR multiple times for different projects.
// Always key remaining/ordered qty by name + project so lines don't collide.
function itemLineKey(name, projectName) {
  return `${String(name || '').trim()}||${String(projectName || '').trim()}`;
}

// Prefer line project, then document/header project (legacy POs may only have header).
function resolveProject(...parts) {
  for (const p of parts) {
    const s = String(p || '').trim();
    if (s) return s;
  }
  return '';
}

async function orderedQtyMap(prId) {
  const pos = await PurchaseOrder.find({ prId }).lean();
  const map = {};
  for (const po of pos)
    for (const it of (po.items || [])) {
      const key = itemLineKey(it.name, resolveProject(it.projectName, po.projectName));
      map[key] = (map[key] || 0) + (it.orderedQty || 0);
    }
  return map;
}

// Resolve ordered qty for a PR line, including legacy PO lines that lost projectName
// (stored under name||) when that material appears only once on the PR.
function orderedForPrLine(map, pr, it) {
  const project = resolveProject(it.projectName, pr.projectName);
  const key = itemLineKey(it.name, project);
  if ((map[key] || 0) > 0) return map[key] || 0;

  const bareKey = itemLineKey(it.name, '');
  const sameNameCount = (pr.items || []).filter(
    (x) => String(x.name || '').trim() === String(it.name || '').trim()
  ).length;
  if (sameNameCount === 1 && (map[bareKey] || 0) > 0) return map[bareKey] || 0;

  return map[key] || 0;
}

async function inwardedQtyMap(poNumbers) {
  if (!poNumbers.length) return {};
  const docs = await Inward.find({ po: { $in: poNumbers } }).lean();
  const map = {};
  for (const doc of docs) {
    if (!doc.po) continue;
    const key = `${doc.po}||${doc.name}`;
    map[key] = (map[key] || 0) + (doc.qty || 0);
  }
  return map;
}

async function syncPrStatus(prId, { note, byName, byUsername } = {}) {
  const pr = await PurchaseRequest.findById(prId);
  if (!pr) return null;

  const updatedOrdered = await orderedQtyMap(prId);
  const fullyCovered = pr.items.every(it =>
    orderedForPrLine(updatedOrdered, pr, it) >= it.qty - 0.00001
  );
  const anyOrdered = pr.items.some(it =>
    orderedForPrLine(updatedOrdered, pr, it) > 0.00001
  );

  const prevStatus = pr.status;
  pr.status = fullyCovered ? 'ordered' : anyOrdered ? 'partial' : 'approved';
  const statusChanged = prevStatus !== pr.status;
  if (statusChanged || note) {
    pr.history.push({
      status: pr.status,
      byName: byName || '',
      byUsername: byUsername || '',
      note: note || `Status corrected from "${prevStatus}" to "${pr.status}" after PO coverage resync.`,
      at: new Date(),
    });
    await pr.save();
  }
  return pr;
}

// Backfill missing PO line projectName from PR / PO header, then resync PR status.
async function healPrPoCoverage(prId) {
  const pr = await PurchaseRequest.findById(prId);
  if (!pr) return null;

  const pos = await PurchaseOrder.find({ prId });
  let itemsFixed = 0;

  for (const po of pos) {
    let changed = false;
    const items = (po.items || []).map((it) => {
      const plain = typeof it.toObject === 'function' ? it.toObject() : { ...it };
      if (resolveProject(plain.projectName)) return plain;

      const sameName = (pr.items || []).filter(
        (x) => String(x.name || '').trim() === String(plain.name || '').trim()
      );
      let lineProject = '';
      if (sameName.length === 1) {
        lineProject = resolveProject(sameName[0].projectName, pr.projectName, po.projectName);
      } else {
        // Single header project (not a joined "A, B" list) is safe to apply
        const header = resolveProject(po.projectName, pr.projectName);
        if (header && !header.includes(',')) lineProject = header;
      }

      if (!lineProject) return plain;
      itemsFixed += 1;
      changed = true;
      return { ...plain, projectName: lineProject };
    });

    if (changed) {
      po.items = items;
      await po.save();
    }
  }

  const prAfter = await syncPrStatus(prId, {
    note: itemsFixed
      ? `Healed ${itemsFixed} PO line project(s) and resynced coverage.`
      : undefined,
  });
  return { pr: prAfter, itemsFixed };
}

// Build a human-readable list of exactly what changed between the old PO
// and the incoming edit — used for the activity log description.
// ── Change-diff helper ────────────────────────────────────────────────────────

const FIELD_LABELS = {
  poNumber: 'PO Number',
  vendorName: 'Vendor',
  projectName: 'Project',
  poDate: 'PO Date',
  poExpectedDate: 'Expected Date',
};

const DATE_FIELDS = new Set(['poDate', 'poExpectedDate']);

// Stored as 'YYYY-MM-DD' → display as 'DD/MM/YYYY'
function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = String(d).split('-');
  if (!y || !m || !day) return String(d);
  return `${day}/${m}/${y}`;
}

function diffPOChanges(oldPo, newFields, newItems) {
  const changes = [];

  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const oldRaw = String(oldPo[key] ?? '').trim();
    const newRaw = String(newFields[key] ?? '').trim();
    if (oldRaw !== newRaw) {
      changes.push({
        field: label,
        from: DATE_FIELDS.has(key) ? fmtDate(oldRaw) : (oldRaw || '—'),
        to:   DATE_FIELDS.has(key) ? fmtDate(newRaw) : (newRaw || '—'),
      });
    }
  }

  const oldItemsByName = Object.fromEntries((oldPo.items || []).map(it => [it.name, it]));
  const newNames = new Set(newItems.map(it => it.name));

  for (const it of newItems) {
    const old = oldItemsByName[it.name];
    if (!old) {
      changes.push({ field: 'Item added', from: '—', to: `${it.name} (qty ${it.orderedQty}, price ${it.price})` });
      continue;
    }
    if (Number(old.orderedQty) !== Number(it.orderedQty))
      changes.push({ field: `${it.name} — Qty`, from: String(old.orderedQty), to: String(it.orderedQty) });
    if (Number(old.price || 0) !== Number(it.price || 0))
      changes.push({ field: `${it.name} — Price`, from: String(old.price || 0), to: String(it.price || 0) });
    if ((old.remarks || '') !== (it.remarks || ''))
      changes.push({ field: `${it.name} — Remarks`, from: old.remarks || '—', to: it.remarks || '—' });
    if ((old.projectName || '') !== (it.projectName || ''))
      changes.push({ field: `${it.name} — Project`, from: old.projectName || '—', to: it.projectName || '—' });
  }

  for (const old of (oldPo.items || [])) {
    if (!newNames.has(old.name)) changes.push({ field: 'Item removed', from: old.name, to: '—' });
  }

  return changes;
}
// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/next-number', authMiddleware, async (req, res) => {
  try {
    const counter    = await Counter.findOne({ _id: 'purchaseOrder' });
    const nextSeqNum = (counter?.seq ?? 0) + 1;
    res.json({ poNumber: `PO-${String(nextSeqNum).padStart(5, '0')}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Recompute PR ordered/partial/approved from existing POs (heals stuck Pending Create PO).
router.post('/resync-status/:prId', authMiddleware, requireRole(...ALLOWED_ROLES), async (req, res) => {
  try {
    const result = await healPrPoCoverage(req.params.prId);
    if (!result?.pr) return res.status(404).json({ error: 'Purchase request not found.' });
    res.json({
      ok: true,
      status: result.pr.status,
      prNumber: result.pr.prNumber,
      itemsFixed: result.itemsFixed || 0,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Heal all approved/partial PRs — backfill legacy PO line projects + resync status.
router.post('/heal-pending', authMiddleware, requireRole(...ALLOWED_ROLES), async (req, res) => {
  try {
    const prs = await PurchaseRequest.find({
      status: { $in: ['approved', 'partial'] },
    }).select('_id prNumber status');

    let healed = 0;
    let itemsFixed = 0;
    const results = [];

    for (const pr of prs) {
      const before = pr.status;
      const result = await healPrPoCoverage(pr._id);
      if (!result?.pr) continue;
      itemsFixed += result.itemsFixed || 0;
      if (result.pr.status !== before) {
        healed += 1;
        results.push({
          prNumber: result.pr.prNumber,
          from: before,
          to: result.pr.status,
        });
      }
    }

    res.json({
      ok: true,
      checked: prs.length,
      healed,
      itemsFixed,
      results,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/by-number/:poNumber', authMiddleware, async (req, res) => {
  try {
    const po = await PurchaseOrder.findOne({ poNumber: req.params.poNumber }).lean();
    if (!po) return res.status(404).json({ error: 'PO not found.' });
    res.json(po);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/po-matching', authMiddleware, async (req, res) => {
  try {
    const allPos   = await PurchaseOrder.find().sort({ createdAt: -1 }).lean();
    const inwarded = await inwardedQtyMap(allPos.map(p => p.poNumber));

    const result = allPos.map(po => {
      const items = (po.items || []).map(it => {
        const receivedQty = inwarded[`${po.poNumber}||${it.name}`] || 0;
        const pendingQty  = Math.max(0, it.orderedQty - receivedQty);
        return { name: it.name, code: it.code || '', uom: it.uom || '',
          orderedQty: it.orderedQty, receivedQty, pendingQty, price: it.price || 0 };
      });
      const fullyReceived    = items.every(it => it.pendingQty  <= 0.00001);
      const partiallyReceived = !fullyReceived && items.some(it => it.receivedQty > 0);
      const status = fullyReceived ? 'received' : partiallyReceived ? 'partial' : 'pending';
      return {
        _id: po._id, poNumber: po.poNumber, poDate: po.poDate,
        poExpectedDate: po.poExpectedDate || '', prNumber: po.prNumber,
        vendorName: po.vendorName, createdByName: po.createdByName, items,
        status,
        // Display labels used by PO Matching UI
        statusLabel:
          status === 'received'
            ? 'Fully Received'
            : status === 'partial'
              ? 'Partially Received'
              : 'Pending Inward Entry',
      };
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pending-inward', authMiddleware, async (req, res) => {
  try {
    const allPos   = await PurchaseOrder.find().sort({ createdAt: -1 }).lean();
    const inwarded = await inwardedQtyMap(allPos.map(p => p.poNumber));

    const result = allPos
      .map(po => {
        const remainingItems = (po.items || []).filter(it => {
          const received = inwarded[`${po.poNumber}||${it.name}`] || 0;
          return received < it.orderedQty - 0.00001;
        }).length;
        return { ...po, remainingItems };
      })
      .filter(po => po.remainingItems > 0);

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const filter = req.query.prId ? { prId: req.query.prId } : {};
    const pagination = parsePagination(req.query);
    const result = await paginateQuery(PurchaseOrder, filter, {
      sort: { createdAt: -1 },
      pagination,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/purchase-orders/:id/activity — newest first
router.get('/:id/activity', authMiddleware, requireRole(...ALLOWED_ROLES), async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id).lean();
    if (!po) return res.status(404).json({ error: 'PO not found.' });
    const list = [...(po.activity || [])].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/purchase-orders — create a new PO
router.post('/', authMiddleware, requireRole(...ALLOWED_ROLES), async (req, res) => {
  try {
    const { poNumber, prNumber, prId, vendorName, projectName, poDate, poExpectedDate, items } = req.body;

    const cleanPoNumber = String(poNumber || '').trim();

    if (!cleanPoNumber)                      return res.status(400).json({ error: 'PO number is required.' });
    if (!prNumber)                           return res.status(400).json({ error: 'PR number is required.' });
    if (!prId)                               return res.status(400).json({ error: 'PR reference id is required.' });
    if (!vendorName)                         return res.status(400).json({ error: 'Vendor name is required.' });
    if (!poDate)                             return res.status(400).json({ error: 'PO date is required.' });
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'At least one item is required.' });

    // const existing = await PurchaseOrder.findOne({ poNumber: cleanPoNumber }).lean();
    // if (existing)
    //   return res.status(409).json({ error: `PO number "${cleanPoNumber}" already exists.` });

    const pr = await PurchaseRequest.findById(prId);
    if (!pr) return res.status(404).json({ error: 'Purchase request not found.' });
    if (!['approved', 'partial', 'ordered'].includes(pr.status))
      return res.status(400).json({ error: `Cannot create a PO for a PR with status "${pr.status}".` });

    const prQtyMap = {};
    for (const it of pr.items || []) {
      const key = itemLineKey(it.name, resolveProject(it.projectName, pr.projectName));
      prQtyMap[key] = (prQtyMap[key] || 0) + (parseFloat(it.qty) || 0);
    }
    const alreadyOrdered = await orderedQtyMap(prId);

    const cleanItems = [];
    for (const it of items) {
      const name       = String(it.name || '').trim();
      const orderedQty = parseFloat(it.orderedQty);
      if (!name || !orderedQty || orderedQty <= 0) continue;

      // Must match prQtyMap keying: line project, else PR/PO header project
      const lineProject = resolveProject(it.projectName, projectName, pr.projectName);
      const key = itemLineKey(name, lineProject);
      const remaining = (prQtyMap[key] ?? 0) - (alreadyOrdered[key] ?? 0);
      if (orderedQty > remaining + 0.00001)
        return res.status(400).json({ error: `"${name}": qty (${orderedQty}) exceeds remaining (${remaining}).` });

      // Count this line toward remaining for later lines in the same request
      // (same material + project must not over-order within one PO).
      alreadyOrdered[key] = (alreadyOrdered[key] || 0) + orderedQty;

      cleanItems.push({
        name, code: it.code || '', category: it.category || '', uom: it.uom || '',
        projectName: lineProject,
        orderedQty, price: parseFloat(it.price) || 0, remarks: it.remarks || '',
      });
    }
    if (!cleanItems.length)
      return res.status(400).json({ error: 'At least one valid item with qty is required.' });

    const po = await PurchaseOrder.create({
      poNumber: cleanPoNumber, prNumber, prId,
      vendorName: vendorName.trim(),
      projectName: projectName || '',
      poDate,
      poExpectedDate: poExpectedDate || '',
      items: cleanItems,
      createdByName: req.user.name, createdByUsername: req.user.username,
      activity: [{
        action: 'created',
        description: `PO ${cleanPoNumber} created against PR ${prNumber}.`,
        performedByName: req.user.name,
        performedByRole: req.user.role,
      }],
    });

    const updatedOrdered = await orderedQtyMap(prId);
    const fullyCovered = pr.items.every(it =>
      orderedForPrLine(updatedOrdered, pr, it) >= it.qty - 0.00001
    );

    if (fullyCovered) {
      pr.status = 'ordered'; pr.poNumber = cleanPoNumber;
      pr.vendor = vendorName.trim(); pr.orderedAt = new Date();
      pr.history.push({ status: 'ordered', byName: req.user.name, byUsername: req.user.username,
        note: `Fully covered. Last PO: ${cleanPoNumber}`, at: new Date() });
    } else {
      pr.status = 'partial';
      pr.history.push({ status: 'partial', byName: req.user.name, byUsername: req.user.username,
        note: `Partial PO created: ${cleanPoNumber}`, at: new Date() });
    }
    await pr.save();

    res.status(201).json({
      ...po.toObject(),
      prStatus: pr.status,
      fullyCovered: !!fullyCovered,
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'PO number collision — please retry.' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/purchase-orders/:id — full edit (fields + items), logs exactly what changed
// PATCH /api/purchase-orders/:id — full edit (fields + items), logs structured field-level diff
// PATCH /api/purchase-orders/:id — full edit (fields + items), logs structured field-level diff
router.patch('/:id', authMiddleware, requireRole(...ALLOWED_ROLES), async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ error: 'PO not found.' });

    const { poNumber, vendorName, projectName, poDate, poExpectedDate, items } = req.body;
    const cleanPoNumber = String(poNumber || '').trim();

    if (!cleanPoNumber)  return res.status(400).json({ error: 'PO number is required.' });
    if (!vendorName)     return res.status(400).json({ error: 'Vendor name is required.' });
    if (!poDate)         return res.status(400).json({ error: 'PO date is required.' });
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'At least one item is required.' });

    // if (cleanPoNumber !== po.poNumber) {
    //   const clash = await PurchaseOrder.findOne({ poNumber: cleanPoNumber, _id: { $ne: po._id } }).lean();
    //   if (clash) return res.status(409).json({ error: `PO number "${cleanPoNumber}" already exists.` });
    // }

    const inwarded = await inwardedQtyMap([po.poNumber]);
    const cleanItems = [];
    for (const it of items) {
      const name       = String(it.name || '').trim();
      const orderedQty = parseFloat(it.orderedQty);
      const price      = parseFloat(it.price);

      if (!name)                          return res.status(400).json({ error: 'Item name is required.' });
      if (!orderedQty || orderedQty <= 0) return res.status(400).json({ error: `"${name}": qty must be > 0.` });
      if (!price || price <= 0)           return res.status(400).json({ error: `"${name}": unit price must be > 0.` });

      const received = inwarded[`${po.poNumber}||${name}`] || 0;
      if (orderedQty < received - 0.00001)
        return res.status(400).json({
          error: `"${name}": ordered qty (${orderedQty}) can't be less than already-received qty (${received}).`,
        });

      cleanItems.push({
        name, code: it.code || '', category: it.category || '', uom: it.uom || '',
        projectName: resolveProject(it.projectName, projectName),
        orderedQty, price, remarks: it.remarks || '',
      });
    }

    const oldPoSnapshot = po.toObject();
    const newFields = {
      poNumber: cleanPoNumber, vendorName: vendorName.trim(),
      projectName: projectName || '', poDate, poExpectedDate: poExpectedDate || '',
    };
    const changes = diffPOChanges(oldPoSnapshot, newFields, cleanItems);

    const oldNumber = po.poNumber;
    po.poNumber       = cleanPoNumber;
    po.vendorName     = vendorName.trim();
    po.projectName    = projectName || '';
    po.poDate          = poDate;
    po.poExpectedDate = poExpectedDate || '';
    po.items           = cleanItems;
    po.activity.push({
      action: 'updated',
      description: changes.length ? `${changes.length} field(s) changed` : 'No changes detected.',
      changes,
      performedByName: req.user.name,
      performedByRole: req.user.role,
    });
    await po.save();

    if (cleanPoNumber !== oldNumber) {
      await Inward.updateMany({ po: oldNumber }, { $set: { po: cleanPoNumber } });
      await PurchaseRequest.updateOne({ poNumber: oldNumber }, { $set: { poNumber: cleanPoNumber } });
    }

    await syncPrStatus(po.prId, {
      note: `PO updated: ${cleanPoNumber}`,
      byName: req.user.name,
      byUsername: req.user.username,
    });

    res.json(po);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'PO number collision — please retry.' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/purchase-orders/:id — admin only
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ error: 'PO not found.' });

    const inwarded = await inwardedQtyMap([po.poNumber]);
    const hasReceipts = Object.keys(inwarded).some(
      k => k.startsWith(`${po.poNumber}||`) && inwarded[k] > 0
    );
    if (hasReceipts)
      return res.status(400).json({ error: 'Cannot delete a PO that already has inward receipts against it.' });

    const prId = po.prId;
    const poNumber = po.poNumber;
    await PurchaseOrder.deleteOne({ _id: po._id });

    await syncPrStatus(prId, {
      note: `PO deleted: ${poNumber}`,
      byName: req.user.name,
      byUsername: req.user.username,
    });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;