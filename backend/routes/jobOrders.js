const router = require("express").Router();
const JobOrder = require("../models/JobOrder");
const { authMiddleware, requireRole } = require("../middleware/auth");
const { parsePagination, paginateQuery } = require("../utils/paginate");

// Matches ROLE_ACCESS.jobOrders in App.jsx
const ALLOWED_ROLES = ["admin", "store_manager", "store", "purchase"];

// Coerce possibly-string numeric fields safely for general math (defaults to 0
// when unusable). Used only where a "no value" and "zero" both mean "skip".
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Coerce a possibly-string numeric field, but preserve "not entered" as null
// instead of collapsing it to 0. Used for anything we persist/display, so a
// genuine 0 stays distinguishable from a blank field.
const toNumOrNull = (v) => {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Area/nos (Sq inch) = Perimeter (mm) × Length (mm) ÷ 645.2
// Computed here — authoritatively, server-side — from perimeter/length.
// Any area value sent by the client is a live-preview-only figure and is
// never trusted or persisted as-is.
const AREA_DIVISOR = 645.2;
function calcArea(perimeter, length) {
  if (perimeter == null || length == null) return null;
  if (!perimeter || !length) return null;
  return (perimeter * length) / AREA_DIVISOR;
}

// ── GET /api/job-orders ───────────────────────────────────────────────────────
// Optional ?page=&limit= → { items, total, page, limit }; otherwise full array.
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    const result = await paginateQuery(JobOrder, {}, {
      sort: { createdAt: -1 },
      pagination,
    });
    res.json(result);
  } catch (err) {
    console.error("[job-orders GET /] ", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/job-orders/:id ───────────────────────────────────────────────────
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const order = await JobOrder.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ error: "Job order not found." });
    res.json(order);
  } catch (err) {
    console.error("[job-orders GET /:id] ", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/job-orders — create ─────────────────────────────────────────────
router.post(
  "/",
  authMiddleware,
  requireRole(...ALLOWED_ROLES),
  async (req, res) => {
    try {
      const {
        srNo,
        date,
        sendFromName,
        sendFromAddress,
        vendorName,
        vehicleNo,
        issuedBy,
        deliveryAddress,
        remarks,
        items,
      } = req.body;

      if (!srNo || !String(srNo).trim())
        return res.status(400).json({ error: "SR No is required." });
      if (!vendorName || !vendorName.trim())
        return res.status(400).json({ error: "Vendor name is required." });
      if (!issuedBy || !issuedBy.trim())
        return res.status(400).json({ error: "Issued By is required." });
      if (!Array.isArray(items) || !items.length)
        return res
          .status(400)
          .json({ error: "At least one item is required." });

      const cleanItems = [];
      const skipped = []; // descriptions of rows dropped for missing required fields, for a clearer error message
      for (const it of items) {
        const description = String(it.description || "").trim();
        const projectName = String(it.projectName || "").trim();
        const qty = parseFloat(it.qty);

        if (!description || !qty || qty <= 0 || !projectName) {
          if (description || projectName || it.qty)
            skipped.push(description || "(unnamed item)");
          continue;
        }

        const weightPerPc = toNumOrNull(it.weightPerPc);
        const perimeter = toNumOrNull(it.perimeter);
        const length = toNumOrNull(it.length);
        const area = calcArea(perimeter, length);

        cleanItems.push({
          description,
          weightPerPc,
          perimeter,
          length,
          area,
          qty,
          unit: it.unit || "NOS",
          process: String(it.process || "").trim(),
          projectName,
          // ralCode: it.ralCode || "",
          remark: it.remark || "",
        });
      }

      if (!cleanItems.length)
        return res
          .status(400)
          .json({
            error:
              "At least one valid item with description, qty, and project name is required.",
          });

      if (skipped.length)
        return res.status(400).json({
          error: `These items are missing description, qty, or project name and were not saved: ${skipped.join(", ")}. Fix them and resubmit.`,
        });

      const existing = await JobOrder.findOne({
        srNo: String(srNo).trim(),
      }).lean();
      if (existing)
        return res
          .status(409)
          .json({ error: `SR No "${srNo}" already exists.` });

      const order = await JobOrder.create({
        srNo: String(srNo).trim(),
        date: date || new Date().toISOString().slice(0, 10),
        sendFromName: String(sendFromName ?? "").trim(),
        sendFromAddress: String(sendFromAddress ?? "").trim(),
        vendorName: vendorName.trim(),
        vehicleNo: vehicleNo || "",
        issuedBy: issuedBy.trim(),
        deliveryAddress: deliveryAddress || "",
        remarks: remarks || "",
        items: cleanItems,
        status: "issued",
        history: [
          {
            action: "issued",
            by: req.user.name || req.user.username,
            note: `Issued to ${vendorName.trim()}`,
            at: new Date(),
          },
        ],
        createdByName: req.user.name,
        createdByUsername: req.user.username,
      });

      res.status(201).json(order.toObject());
    } catch (err) {
      console.error("[job-orders POST /] ", err);
      if (err.code === 11000)
        return res
          .status(409)
          .json({ error: "SR No collision — please retry." });
      res.status(500).json({ error: err.message });
    }
  },
);

// ── PATCH /api/job-orders/:id — edit ──────────────────────────────────────────
// Header fields (srNo, date, vendorName, vehicleNo, issuedBy, deliveryAddress,
// remarks) can always be edited.
//
// The item list itself can only be replaced while the order is still fully
// 'issued' (nothing received yet). Once any receiving has happened, each
// item's receivedQty/receipts are tied to that item's position in the array
// — adding, removing, or reordering items at that point would silently
// corrupt the qty-tracking for whatever was already received. So once status
// is 'partial' or 'received', an `items` payload is rejected; the client can
// still PATCH header fields alone by omitting `items` from the body.
router.patch(
  "/:id",
  authMiddleware,
  requireRole(...ALLOWED_ROLES),
  async (req, res) => {
    try {
      const order = await JobOrder.findById(req.params.id);
      if (!order)
        return res.status(404).json({ error: "Job order not found." });

      const {
        srNo,
        date,
        sendFromName,
        sendFromAddress,
        vendorName,
        vehicleNo,
        issuedBy,
        deliveryAddress,
        remarks,
        items,
      } = req.body;

      if (srNo !== undefined) {
        const trimmed = String(srNo).trim();
        if (!trimmed)
          return res.status(400).json({ error: "SR No is required." });
        if (trimmed !== order.srNo) {
          const dup = await JobOrder.findOne({
            srNo: trimmed,
            _id: { $ne: order._id },
          }).lean();
          if (dup)
            return res
              .status(409)
              .json({ error: `SR No "${trimmed}" already exists.` });
        }
        order.srNo = trimmed;
      }
      if (date !== undefined && date) order.date = date;
      if (sendFromName !== undefined) {
        order.sendFromName = String(sendFromName ?? "").trim();
      }
      if (sendFromAddress !== undefined) {
        order.sendFromAddress = String(sendFromAddress ?? "").trim();
      }
      if (vendorName !== undefined) {
        if (!vendorName.trim())
          return res.status(400).json({ error: "Vendor name is required." });
        order.vendorName = vendorName.trim();
      }
      if (vehicleNo !== undefined) order.vehicleNo = vehicleNo;
      if (issuedBy !== undefined) {
        if (!issuedBy.trim())
          return res.status(400).json({ error: "Issued By is required." });
        order.issuedBy = issuedBy.trim();
      }
      if (deliveryAddress !== undefined)
        order.deliveryAddress = deliveryAddress;
      if (remarks !== undefined) order.remarks = remarks;

      let itemsChanged = false;
      if (items !== undefined) {
        if (order.status !== "issued") {
          return res.status(400).json({
            error:
              "Items can no longer be edited — receiving has already started on this order. Header fields (vendor, vehicle no, delivery address, etc) can still be edited.",
          });
        }
        if (!Array.isArray(items) || !items.length)
          return res
            .status(400)
            .json({ error: "At least one item is required." });

        const cleanItems = [];
        const skipped = [];
        for (const it of items) {
          const description = String(it.description || "").trim();
          const projectName = String(it.projectName || "").trim();
          const qty = parseFloat(it.qty);
          if (!description || !qty || qty <= 0 || !projectName) {
            if (description || projectName || it.qty)
              skipped.push(description || "(unnamed item)");
            continue;
          }
          const weightPerPc = toNumOrNull(it.weightPerPc);
          const perimeter = toNumOrNull(it.perimeter);
          const length = toNumOrNull(it.length);
          const area = calcArea(perimeter, length);
          cleanItems.push({
            description,
            weightPerPc,
            perimeter,
            length,
            area,
            qty,
            unit: it.unit || "NOS",
            process: String(it.process || "").trim(),
            projectName,
            ralCode: it.ralCode || "",
            remark: it.remark || "",
            receivedQty: 0,
            receipts: [],
          });
        }
        if (!cleanItems.length)
          return res
            .status(400)
            .json({
              error:
                "At least one valid item with description, qty, and project name is required.",
            });
        if (skipped.length)
          return res.status(400).json({
            error: `These items are missing description, qty, or project name and were not saved: ${skipped.join(", ")}. Fix them and resubmit.`,
          });

        order.items = cleanItems;
        itemsChanged = true;
      }

      order.history.push({
        action: "edited",
        by: req.user.name || req.user.username,
        note: itemsChanged
          ? "Order details and items updated."
          : "Order details updated.",
        at: new Date(),
      });

      // Same safety net as the receive route — guarantees the items array is
      // persisted even if Mongoose's automatic dirty-tracking misses a change.
      order.markModified("items");
      await order.save();

      const saved = await JobOrder.findById(order._id).lean();
      res.json(saved);
    } catch (err) {
      console.error("[job-orders PATCH /:id] ", err);
      if (err.code === 11000)
        return res
          .status(409)
          .json({ error: "SR No collision — please retry." });
      res.status(500).json({ error: err.message });
    }
  },
);

// ── PATCH /api/job-orders/:id/receive — mark received (supports partial) ──────
// items[] is positional and MUST align with order.items — the frontend builds
// it by iterating order.items in order, so this holds as long as nothing
// reorders order.items between fetch and submit.
//
// Partial receiving: for each item, `receiving` only needs to be <= remaining
// (qty - receivedQty so far) — it does NOT have to equal the full remaining
// amount. Whatever isn't received now just stays pending; status becomes
// 'partial' until every item's receivedQty reaches its qty, at which point
// status flips to 'received'.
router.patch(
  "/:id/receive",
  authMiddleware,
  requireRole(...ALLOWED_ROLES),
  async (req, res) => {
    try {
      const { items, receivedBy, challanNo, note } = req.body;
      console.log(
        "[job-orders PATCH /:id/receive] incoming",
        req.params.id,
        JSON.stringify(req.body),
      );

      const order = await JobOrder.findById(req.params.id);
      if (!order)
        return res.status(404).json({ error: "Job order not found." });

      if (!Array.isArray(items) || items.length !== order.items.length) {
        console.error("[job-orders PATCH /:id/receive] length mismatch", {
          payloadLength: Array.isArray(items) ? items.length : typeof items,
          orderItemsLength: order.items.length,
        });
        return res
          .status(400)
          .json({ error: "Items payload must align with order items." });
      }

      const receivedLines = [];
      let anyReceived = false;

      for (let i = 0; i < order.items.length; i++) {
        const it = order.items[i];
        const entry = items[i] || {};
        const receiving = num(entry.receiving);
        if (receiving <= 0) continue; // this item is being left pending — fine, that's partial receiving

        const remaining = Math.max(0, num(it.qty) - num(it.receivedQty));
        if (receiving > remaining + 0.0001)
          return res
            .status(400)
            .json({
              error: `"${it.description}": can't receive ${receiving}, only ${remaining} pending.`,
            });
        if (!entry.location || !String(entry.location).trim())
          return res
            .status(400)
            .json({ error: `Location is required for "${it.description}".` });

        it.receipts.push({
          qty: receiving,
          location: entry.location,
          receivedBy: receivedBy || req.user.name || req.user.username,
          note: note || "",
          at: new Date(),
        });
        it.receivedQty = Math.min(num(it.qty), num(it.receivedQty) + receiving);
        anyReceived = true;
        receivedLines.push(
          `${it.description}: ${receiving} ${it.unit} @ ${entry.location}`,
        );
      }

      if (!anyReceived)
        return res
          .status(400)
          .json({ error: "Enter a received quantity for at least one item." });

      // Status derived from actual item quantities, not trusted from the client.
      // If any item still has qty - receivedQty > 0, this stays 'partial' — that's
      // what lets the same order be received again later for the remaining qty.
      const allReceived = order.items.every(
        (it) => num(it.receivedQty) >= num(it.qty) - 0.0001,
      );
      order.status = allReceived ? "received" : "partial";

      // Order-level summary fields — kept for quick display / backward compatibility.
      // Item-level `receipts` remain the source of truth for exact location breakdown.
      const distinctLocations = [
        ...new Set(
          order.items.flatMap((it) => it.receipts.map((r) => r.location)),
        ),
      ];
      if (distinctLocations.length === 1)
        order.receivedAt = distinctLocations[0];
      else if (distinctLocations.length > 1)
        order.receivedAt = "Multiple locations";
      order.receivedBy = receivedBy || order.receivedBy;
      if (challanNo && String(challanNo).trim())
        order.challanNo = String(challanNo).trim();

      order.history.push({
        action: allReceived ? "received" : "partial-received",
        by: receivedBy || req.user.name || req.user.username,
        note:
          receivedLines.join("; ") +
          (challanNo ? ` — Challan No: ${challanNo}` : "") +
          (note ? ` — ${note}` : ""),
        at: new Date(),
      });

      // markModified is a safety net: Mongoose usually tracks nested subdocument
      // array mutations (push, direct field assignment) automatically, but if
      // this .save() ever silently doesn't persist item-level changes, this
      // guarantees the whole items array is written.
      order.markModified("items");
      await order.save();

      console.log(
        "[job-orders PATCH /:id/receive] saved",
        order._id.toString(),
        "status:",
        order.status,
      );
      res.json(order);
    } catch (err) {
      console.error("[job-orders PATCH /:id/receive] ", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── DELETE /api/job-orders/:id — delete ───────────────────────────────────────
// Admin-only. Unlike edit/receive, this is destructive and irreversible, so
// it gets its own tighter role check ('admin' only) instead of ALLOWED_ROLES
// — store/purchase/store_manager can create, edit and receive, but not delete.
router.delete(
  "/:id",
  authMiddleware,
  requireRole("admin"),
  async (req, res) => {
    try {
      const order = await JobOrder.findById(req.params.id);
      if (!order)
        return res.status(404).json({ error: "Job order not found." });

      await JobOrder.deleteOne({ _id: order._id });

      console.log(
        "[job-orders DELETE /:id]",
        order._id.toString(),
        "srNo:",
        order.srNo,
        "deleted by:",
        req.user.name || req.user.username,
      );

      res.json({ success: true, _id: order._id });
    } catch (err) {
      console.error("[job-orders DELETE /:id] ", err);
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
