const router = require("express").Router();
const mongoose = require("mongoose");
const JobOrder = require("../models/JobOrder");
const User = require("../models/User");
const { authMiddleware, requireRole } = require("../middleware/auth");
const { parsePagination, paginateQuery } = require("../utils/paginate");

// Matches ROLE_ACCESS.jobOrders in App.jsx
const ALLOWED_ROLES = ["admin", "store_manager", "store", "purchase"];
// Viewers can mark material received at store, but not create/edit/delete challans.
const RECEIVE_ROLES = [...ALLOWED_ROLES, "viewer"];

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

// Factory is stored as-is. Site must include a typed site name.
function resolveReceiveLocation(entry) {
  const loc = String(entry?.location || "").trim();
  if (!loc) return { error: "Location is required" };
  if (loc === "Site") {
    const siteName = String(entry?.siteName || "").trim();
    if (!siteName) return { error: "Site name is compulsory" };
    return { value: `Site — ${siteName}` };
  }
  return { value: loc };
}

// yyyy-mm-dd only. Rejects empty and impossible dates (e.g. 2026-02-31).
function parseCalendarDate(value) {
  const s = String(value || "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(y, month - 1, day));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  )
    return "";
  return s;
}

function sameVendor(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const JOB_TYPES = JobOrder.JOB_TYPES || ["powder_coating", "fabrication"];

function normalizeJobType(value) {
  const t = String(value || "").trim();
  return JOB_TYPES.includes(t) ? t : "";
}

/** Optional ?jobType=powder_coating|fabrication. Legacy docs without jobType count as powder_coating. */
function jobTypeFilter(jobType) {
  const t = normalizeJobType(jobType);
  if (!t) return {};
  if (t === "fabrication") return { jobType: "fabrication" };
  return {
    $or: [
      { jobType: "powder_coating" },
      { jobType: { $exists: false } },
      { jobType: null },
      { jobType: "" },
    ],
  };
}

function mergeFilters(...parts) {
  const clean = parts.filter((p) => p && Object.keys(p).length > 0);
  if (!clean.length) return {};
  if (clean.length === 1) return clean[0];
  return { $and: clean };
}

// Vendor logins are scoped to one company and one job type (powder / fabrication).
// Values are read from the user record so an admin change applies on the next request.
async function vendorFilter(req) {
  if (req.user?.role !== "vendor") return {};
  const user = await User.findById(req.user.id).select("vendorName vendorJobType").lean();
  const name = String(user?.vendorName || "").trim();
  if (!name) return { _id: null };
  const jobType =
    user?.vendorJobType === "fabrication" ? "fabrication" : "powder_coating";
  return mergeFilters(
    { vendorName: new RegExp(`^${escapeRegExp(name)}$`, "i") },
    jobTypeFilter(jobType),
  );
}

async function loadVendorUser(req) {
  if (req.user?.role !== "vendor") return null;
  return User.findById(req.user.id).select("vendorName vendorJobType").lean();
}

function vendorOwnsOrder(user, order) {
  if (!user) return false;
  if (!sameVendor(user.vendorName, order.vendorName)) return false;
  const userType =
    user.vendorJobType === "fabrication" ? "fabrication" : "powder_coating";
  const orderType =
    order.jobType === "fabrication" ? "fabrication" : "powder_coating";
  return userType === orderType;
}

function roundQty(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function latestReadyPercent(item) {
  const fromRounds = (item?.qcRounds || []).reduce(
    (max, round) => Math.max(max, Number(round.readyPercent) || 0),
    0,
  );
  return Math.max(fromRounds, Number(item?.readyPercent) || 0);
}

function submittedReadyQty(item) {
  return roundQty(
    (item?.qcRounds || []).reduce((sum, round) => {
      if (round.origin === "rework") return sum;
      return sum + (Number(round.readyQty) || 0);
    }, 0),
  );
}

function reworkQty(item) {
  const rejected = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "inspected") return sum;
    return sum + (Number(round.rejectedQty) || 0);
  }, 0);
  const sentBack = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.origin !== "rework") return sum;
    return sum + (Number(round.readyQty) || 0);
  }, 0);
  return roundQty(Math.max(0, rejected - sentBack));
}

function readyToDispatchQty(item) {
  return roundQty(
    (item?.qcRounds || []).reduce((sum, round) => {
      if (round.status !== "inspected") return sum;
      return sum + (Number(round.dispatchQty) || 0);
    }, 0),
  );
}

function receivableNow(item) {
  const dispatchLeft = Math.max(0, readyToDispatchQty(item) - num(item?.receivedQty));
  const orderLeft = Math.max(0, num(item?.qty) - num(item?.receivedQty));
  return roundQty(Math.min(dispatchLeft, orderLeft));
}

// ── GET /api/job-orders ───────────────────────────────────────────────────────
// Optional ?page=&limit= → { items, total, page, limit }; otherwise full array.
// Vendor role only receives orders issued to their own company.
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    const filter = mergeFilters(
      await vendorFilter(req),
      jobTypeFilter(req.query.jobType),
    );
    const result = await paginateQuery(JobOrder, filter, {
      sort: { createdAt: -1 },
      pagination,
    });
    res.json(result);
  } catch (err) {
    console.error("[job-orders GET /] ", err);
    res.status(500).json({ error: err.message });
  }
});

// Send From / Send To / Issued By spellings used on job orders (for rename UI).
const JO_NAME_FIELDS = {
  sendFromName: "Send From",
  vendorName: "Send To",
  issuedBy: "Issued By",
};

router.get(
  "/name-values",
  authMiddleware,
  requireRole("admin", "store_manager", "purchase"),
  async (req, res) => {
    try {
      const field = String(req.query.field || "");
      if (!JO_NAME_FIELDS[field]) {
        return res
          .status(400)
          .json({ error: "Choose Send From, Send To, or Issued By." });
      }
      // Same jobType scope as the Powder Coating / Fabrication list (includes
      // legacy rows with missing/empty jobType on the powder_coating page).
      const match = mergeFilters(
        { [field]: { $nin: [null, ""] } },
        jobTypeFilter(req.query.jobType),
      );
      const rows = await JobOrder.aggregate([
        { $match: match },
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]);
      res.json({
        field,
        values: rows
          .filter((row) => String(row._id || "").trim())
          .map((row) => ({ value: String(row._id), count: row.count || 0 })),
      });
    } catch (err) {
      console.error("[job-orders GET /name-values] ", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// Merge selected spellings into one name on job orders (and vendor logins for Send To).
router.post(
  "/rename-names",
  authMiddleware,
  requireRole("admin", "store_manager", "purchase"),
  async (req, res) => {
    try {
      const field = String(req.body.field || "");
      if (!JO_NAME_FIELDS[field]) {
        return res
          .status(400)
          .json({ error: "Choose Send From, Send To, or Issued By." });
      }
      const to = String(req.body.to || "")
        .trim()
        .replace(/\s+/g, " ");
      if (!to) return res.status(400).json({ error: "Enter the name to use." });

      const from = [
        ...new Set(
          (Array.isArray(req.body.from) ? req.body.from : [])
            .map((value) => String(value ?? ""))
            .filter((value) => value.trim() && value !== to),
        ),
      ];
      if (!from.length) {
        return res
          .status(400)
          .json({ error: "Select at least one name to change." });
      }
      if (from.length > 200) {
        return res.status(400).json({ error: "Select fewer names at once." });
      }

      // Case-insensitive exact match for each selected spelling (covers casing leftovers).
      const nameMatchers = [
        ...new Set(
          from
            .map((name) => String(name).trim().replace(/\s+/g, " "))
            .filter(Boolean),
        ),
      ].map(
        (name) => new RegExp(`^${escapeRegExp(name)}$`, "i"),
      );
      const filter = mergeFilters(
        { $or: nameMatchers.map((re) => ({ [field]: re })) },
        jobTypeFilter(req.body.jobType),
      );

      const orderResult = await JobOrder.updateMany(filter, {
        $set: { [field]: to },
      });

      let usersUpdated = 0;
      // Keep vendor logins linked when Send To (vendor company) is renamed.
      if (field === "vendorName") {
        const userResult = await User.updateMany(
          {
            role: "vendor",
            $or: nameMatchers.map((re) => ({ vendorName: re })),
          },
          { $set: { vendorName: to } },
        );
        usersUpdated = userResult.modifiedCount || 0;
      }

      res.json({
        updated: orderResult.modifiedCount || 0,
        usersUpdated,
        to,
      });
    } catch (err) {
      console.error("[job-orders POST /rename-names] ", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── GET /api/job-orders/:id ───────────────────────────────────────────────────
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const order = await JobOrder.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ error: "Job order not found." });
    if (req.user?.role === "vendor") {
      const vendorUser = await loadVendorUser(req);
      if (!vendorOwnsOrder(vendorUser, order))
        return res.status(404).json({ error: "Job order not found." });
    }
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
        jobType,
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

      const resolvedJobType = normalizeJobType(jobType) || "powder_coating";

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
          readyPercent: 0,
          qcRounds: [],
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
        jobType: resolvedJobType,
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
            note: `Issued to ${vendorName.trim()} (${resolvedJobType === "fabrication" ? "Fabrication" : "Powder Coating"})`,
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
          const prev = order.items[cleanItems.length];
          const keepQc =
            prev && String(prev.description || "").trim() === description;
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
            readyPercent: keepQc ? latestReadyPercent(prev) : 0,
            qcRounds: keepQc ? (prev.qcRounds || []).map((round) => ({ ...round.toObject?.() || round })) : [],
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
  requireRole(...RECEIVE_ROLES),
  async (req, res) => {
    try {
      const { items, receivedBy, challanNo, note, receivedDate } = req.body;
      const receiveDay = parseCalendarDate(receivedDate);
      if (!receiveDay)
        return res
          .status(400)
          .json({ error: "Receive date is compulsory." });

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
      const lotId = new mongoose.Types.ObjectId().toString();
      const savedAt = new Date();
      const lotChallan = challanNo ? String(challanNo).trim() : "";

      for (let i = 0; i < order.items.length; i++) {
        const it = order.items[i];
        const entry = items[i] || {};
        const receiving = num(entry.receiving);
        if (receiving <= 0) continue; // this item is being left pending — fine, that's partial receiving

        const remaining = Math.max(0, num(it.qty) - num(it.receivedQty));
        const dispatchQty = readyToDispatchQty(it);
        const allowed = receivableNow(it);
        if (receiving > remaining + 0.0001)
          return res
            .status(400)
            .json({
              error: `"${it.description}": can't receive ${receiving}, only ${remaining} pending.`,
            });
        if (receiving > allowed + 0.0001)
          return res.status(400).json({
            error: allowed <= 0.0001
              ? `"${it.description}": nothing is ready to dispatch, so it cannot be received.`
              : `"${it.description}": cannot receive more than ready to dispatch (${dispatchQty}). Only ${allowed} is still left to receive.`,
          });
        const location = resolveReceiveLocation(entry);
        if (location.error)
          return res
            .status(400)
            .json({ error: `${location.error} ("${it.description}").` });

        it.receipts.push({
          qty: receiving,
          location: location.value,
          receivedBy: receivedBy || req.user.name || req.user.username,
          note: note || "",
          receivedDate: receiveDay,
          lotId,
          challanNo: lotChallan,
          at: savedAt,
        });
        it.receivedQty = Math.min(num(it.qty), num(it.receivedQty) + receiving);
        anyReceived = true;
        receivedLines.push(
          `${it.description}: ${receiving} ${it.unit} @ ${location.value}`,
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
          ` — Receive date: ${receiveDay.split("-").reverse().join("/")}` +
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

// ── PATCH /api/job-orders/:id/vendor-ack ──────────────────────────────────────
// Vendor confirms materials arrived and sets the expected ready date.
// Optional body.items[]: { itemIndex, qty } — correct order qty when physical
// receive qty does not match the challan (only allowed before QC lots exist).
router.patch("/:id/vendor-ack", authMiddleware, async (req, res) => {
  try {
    const role = req.user?.role;
    if (role !== "vendor" && role !== "admin")
      return res.status(403).json({ error: "Only the vendor team or an admin can receive this challan." });

    const order = await JobOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Job order not found." });

    if (role === "vendor") {
      const vendorUser = await loadVendorUser(req);
      if (!vendorOwnsOrder(vendorUser, order))
        return res.status(404).json({ error: "Job order not found." });
    }

    if (order.vendorExpectedDate)
      return res.status(400).json({ error: "This challan is already received by the vendor." });

    const expectedDate = parseCalendarDate(req.body?.expectedDate);
    if (!expectedDate)
      return res.status(400).json({ error: "Expected date is compulsory." });

    const who = req.user.name || req.user.username;
    const note = String(req.body?.note || "").trim();
    const qtyChanges = [];

    const itemUpdates = Array.isArray(req.body?.items) ? req.body.items : [];
    for (const entry of itemUpdates) {
      const itemIndex = Number(entry?.itemIndex);
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
        return res.status(400).json({ error: "Invalid item index in receive qty update." });
      }
      const item = order.items[itemIndex];
      if ((item.qcRounds || []).length > 0) {
        return res.status(400).json({
          error: `"${item.description || "Item"}": cannot change qty after QC lots exist.`,
        });
      }
      if (num(item.receivedQty) > 0.0001) {
        return res.status(400).json({
          error: `"${item.description || "Item"}": cannot change qty after store has received material.`,
        });
      }
      const nextQty = Number(entry?.qty);
      if (!Number.isFinite(nextQty) || nextQty <= 0) {
        return res.status(400).json({
          error: `"${item.description || "Item"}": received qty must be greater than 0.`,
        });
      }
      const prevQty = num(item.qty);
      const rounded = Math.round(nextQty * 1000) / 1000;
      if (Math.abs(rounded - prevQty) > 0.0001) {
        item.qty = rounded;
        qtyChanges.push(
          `${item.description || `Item ${itemIndex + 1}`}: ${prevQty} → ${rounded}`,
        );
      }
    }

    order.vendorExpectedDate = expectedDate;
    order.vendorAckBy = who;
    order.vendorAckAt = new Date();
    order.vendorAckNote = note;
    order.history.push({
      action: "vendor-ack",
      by: who,
      note:
        `Vendor received challan. Expected date: ${expectedDate.split("-").reverse().join("/")}` +
        (qtyChanges.length
          ? ` — Qty updated: ${qtyChanges.join("; ")}`
          : "") +
        (note ? ` — ${note}` : ""),
      at: new Date(),
    });
    await order.save();
    res.json(await JobOrder.findById(order._id).lean());
  } catch (err) {
    console.error("[job-orders PATCH /:id/vendor-ack] ", err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/job-orders/:id/qc-stage ────────────────────────────────────────
// request_qc  vendor sends a ready % for inspection. Locked until QC finishes.
// inspect     QC records dispatch / rework / scrap from a pending ready lot.
//             dispatchQty + rejectedQty + scrapQty must cover the inspected qty.
// skip_qc     QC/admin skips quality check; qty goes to ready-to-dispatch.
//             Requires skipRemark. Works on pending lots, or remaining unsent qty.
router.patch("/:id/qc-stage", authMiddleware, async (req, res) => {
  try {
    const action = String(req.body?.action || "");
    const itemIndex = Number(req.body?.itemIndex);
    const role = req.user?.role;

    const order = await JobOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Job order not found." });

    if (role === "vendor") {
      const vendorUser = await loadVendorUser(req);
      if (!vendorOwnsOrder(vendorUser, order))
        return res.status(404).json({ error: "Job order not found." });
    }

    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length)
      return res.status(400).json({ error: "Choose a material on this job order." });

    const item = order.items[itemIndex];
    const who = req.user.name || req.user.username;
    const now = new Date();
    let note = "";

    if (action === "request_qc") {
      if (role !== "vendor" && role !== "admin")
        return res.status(403).json({ error: "Only the vendor team or an admin can update how much is ready." });
      if (!order.vendorExpectedDate)
        return res.status(400).json({
          error: "Receive this challan first and enter the expected date.",
        });
      const orderQty = roundQty(item.qty);
      const previousQty = submittedReadyQty(item);
      const remaining = roundQty(orderQty - previousQty);
      const lotQty = roundQty(req.body?.readyQty);
      if (remaining <= 0.001)
        return res.status(400).json({ error: "All of this material is already submitted." });
      if (!Number.isFinite(lotQty) || lotQty <= 0)
        return res.status(400).json({ error: "Enter the quantity for this lot." });
      if (lotQty - orderQty > 0.001 || lotQty - remaining > 0.001)
        return res.status(400).json({
          error: `Cannot update more than the quantity (${lotQty - orderQty > 0.001 ? orderQty : remaining}).`,
        });

      const readyTotal = roundQty(previousQty + lotQty);
      const readyQty = lotQty;
      const percent = orderQty ? Math.round((readyTotal / orderQty) * 10000) / 100 : 0;

      item.readyPercent = percent;
      item.qcRounds.push({
        readyPercent: percent,
        readyQty,
        status: "pending",
        dispatchQty: 0,
        rejectedQty: 0,
        scrapQty: 0,
        submittedBy: who,
        submittedAt: now,
      });
      note = `${item.description}: lot ${readyQty} sent for QC (${readyTotal} of ${orderQty}, ${percent}%)`;
    } else if (action === "send_rework") {
      if (role !== "vendor" && role !== "admin")
        return res.status(403).json({ error: "Only the vendor team or an admin can send rework." });
      const open = reworkQty(item);
      const lotQty = roundQty(req.body?.readyQty);
      if (open <= 0.001)
        return res.status(400).json({ error: "No quantity is in rework." });
      if (!Number.isFinite(lotQty) || lotQty <= 0)
        return res.status(400).json({ error: "Enter the rework quantity." });
      if (lotQty - open > 0.001)
        return res.status(400).json({
          error: `Cannot update more than the quantity (${open}).`,
        });
      item.qcRounds.push({
        readyPercent: Number(item.readyPercent) || 0,
        readyQty: lotQty,
        status: "pending",
        origin: "rework",
        dispatchQty: 0,
        rejectedQty: 0,
        scrapQty: 0,
        submittedBy: who,
        submittedAt: now,
      });
      note = `${item.description}: ${lotQty} rework sent for QC`;
    } else if (action === "inspect") {
      if (role !== "quality" && role !== "admin")
        return res.status(403).json({ error: "Only QC or an admin can record ready to dispatch, rework, and reject quantities." });

      const waiting = (item.qcRounds || []).filter((round) => round.status === "pending");
      const merged = roundQty(waiting.reduce((sum, round) => sum + (Number(round.readyQty) || 0), 0));
      if (!waiting.length)
        return res.status(400).json({ error: "Nothing is waiting for QC on this material." });

      const dispatchQty = roundQty(req.body?.dispatchQty);
      const rejectedQty = roundQty(req.body?.rejectedQty);
      const scrapQty = roundQty(req.body?.scrapQty);
      const reworkRemark = String(req.body?.reworkRemark || "").trim();
      const scrapRemark = String(req.body?.scrapRemark || "").trim();
      if (
        !Number.isFinite(dispatchQty) || dispatchQty < 0
        || !Number.isFinite(rejectedQty) || rejectedQty < 0
        || !Number.isFinite(scrapQty) || scrapQty < 0
      ) {
        return res.status(400).json({ error: "Enter accept, rework, and reject quantities." });
      }
      const orderQty = roundQty(item.qty);
      const inspectedQty = roundQty(dispatchQty + rejectedQty + scrapQty);
      if (inspectedQty <= 0)
        return res.status(400).json({ error: "Enter the quantity you inspected." });
      if (rejectedQty > 0.001 && !reworkRemark)
        return res.status(400).json({ error: "Enter a remark for the rework quantity." });
      if (scrapQty > 0.001 && !scrapRemark)
        return res.status(400).json({ error: "Enter a remark for the rejected quantity." });
      if (
        dispatchQty - merged > 0.001
        || rejectedQty - merged > 0.001
        || scrapQty - merged > 0.001
        || inspectedQty - merged > 0.001
      ) {
        return res.status(400).json({
          error: `Cannot update more than the quantity (${merged}).`,
        });
      }
      const alreadyDispatch = readyToDispatchQty(item);
      const dispatchRoom = roundQty(Math.max(0, orderQty - alreadyDispatch));
      if (dispatchQty - dispatchRoom > 0.001)
        return res.status(400).json({
          error: `Cannot update more than the quantity (${dispatchRoom}). Ready to dispatch is already ${alreadyDispatch}.`,
        });
      if (rejectedQty - orderQty > 0.001 || scrapQty - orderQty > 0.001 || inspectedQty - orderQty > 0.001)
        return res.status(400).json({
          error: `Cannot update more than the quantity (${orderQty}).`,
        });

      let dispatchLeft = dispatchQty;
      let rejectedLeft = rejectedQty;
      let scrapLeft = scrapQty;
      let remarkLeft = reworkRemark;
      let scrapRemarkLeft = scrapRemark;
      const nextRounds = [];
      for (const round of item.qcRounds || []) {
        const pendingLeft = roundQty(dispatchLeft + rejectedLeft + scrapLeft);
        if (round.status !== "pending" || pendingLeft <= 0.001) {
          nextRounds.push(round.toObject());
          continue;
        }
        const ready = roundQty(round.readyQty);
        const take = Math.min(ready, pendingLeft);
        let left = take;
        const takeDispatch = Math.min(dispatchLeft, left);
        left = roundQty(left - takeDispatch);
        const takeRejected = Math.min(rejectedLeft, left);
        left = roundQty(left - takeRejected);
        const takeScrap = Math.min(scrapLeft, left);
        dispatchLeft = roundQty(dispatchLeft - takeDispatch);
        rejectedLeft = roundQty(rejectedLeft - takeRejected);
        scrapLeft = roundQty(scrapLeft - takeScrap);
        const takeRemark = takeRejected > 0.001 ? remarkLeft : "";
        if (takeRejected > 0.001) remarkLeft = "";
        const takeScrapRemark = takeScrap > 0.001 ? scrapRemarkLeft : "";
        if (takeScrap > 0.001) scrapRemarkLeft = "";
        nextRounds.push({
          readyPercent: round.readyPercent,
          readyQty: take,
          status: "inspected",
          origin: round.origin === "rework" ? "rework" : "order",
          dispatchQty: takeDispatch,
          rejectedQty: takeRejected,
          scrapQty: takeScrap,
          reworkRemark: takeRemark,
          scrapRemark: takeScrapRemark,
          skipped: false,
          skipRemark: "",
          submittedBy: round.submittedBy || "",
          submittedAt: round.submittedAt || null,
          inspectedBy: who,
          inspectedAt: now,
        });
        const leftOnRound = roundQty(ready - take);
        if (leftOnRound > 0.001) {
          nextRounds.push({
            readyPercent: round.readyPercent,
            readyQty: leftOnRound,
            status: "pending",
            origin: round.origin === "rework" ? "rework" : "order",
            dispatchQty: 0,
            rejectedQty: 0,
            scrapQty: 0,
            reworkRemark: "",
            scrapRemark: "",
            skipped: false,
            skipRemark: "",
            submittedBy: round.submittedBy || "",
            submittedAt: round.submittedAt || null,
            inspectedBy: "",
            inspectedAt: null,
          });
        }
      }
      item.qcRounds = nextRounds;
      const stillPending = roundQty(merged - inspectedQty);
      const dispatchTotal = roundQty(alreadyDispatch + dispatchQty);
      const parts = [];
      if (dispatchQty > 0.001) parts.push(`${dispatchQty} accepted (dispatch total ${dispatchTotal})`);
      if (rejectedQty > 0.001) parts.push(`${rejectedQty} rework${reworkRemark ? ` (${reworkRemark})` : ""}`);
      if (scrapQty > 0.001) parts.push(`${scrapQty} rejected${scrapRemark ? ` (${scrapRemark})` : ""}`);
      note = `${item.description}: QC ${parts.join(", ") || "updated"}.${stillPending > 0.001 ? ` ${stillPending} still pending inspection.` : ""}`;
    } else if (action === "skip_qc") {
      if (role !== "quality" && role !== "admin")
        return res.status(403).json({ error: "Only QC or an admin can skip quality checking." });

      const skipRemark = String(req.body?.skipRemark || "").trim();
      if (!skipRemark)
        return res.status(400).json({ error: "Enter a remark explaining why QC is skipped." });

      const orderQty = roundQty(item.qty);
      const waiting = (item.qcRounds || []).filter((round) => round.status === "pending");
      const pendingQty = roundQty(
        waiting.reduce((sum, round) => sum + (Number(round.readyQty) || 0), 0),
      );
      const remaining = roundQty(orderQty - submittedReadyQty(item));
      const alreadyDispatch = readyToDispatchQty(item);
      const dispatchRoom = roundQty(Math.max(0, orderQty - alreadyDispatch));

      if (waiting.length) {
        if (pendingQty - dispatchRoom > 0.001)
          return res.status(400).json({
            error: `Cannot skip more than the quantity still open for dispatch (${dispatchRoom}).`,
          });
        item.qcRounds = (item.qcRounds || []).map((round) => {
          if (round.status !== "pending") return round.toObject?.() || round;
          const ready = roundQty(round.readyQty);
          return {
            readyPercent: round.readyPercent,
            readyQty: ready,
            status: "inspected",
            origin: round.origin === "rework" ? "rework" : "order",
            dispatchQty: ready,
            rejectedQty: 0,
            scrapQty: 0,
            reworkRemark: "",
            scrapRemark: "",
            skipped: true,
            skipRemark,
            submittedBy: round.submittedBy || "",
            submittedAt: round.submittedAt || null,
            inspectedBy: who,
            inspectedAt: now,
          };
        });
        note = `${item.description}: QC skipped for ${pendingQty}. Reason: ${skipRemark}`;
      } else if (remaining > 0.001) {
        const take = Math.min(remaining, dispatchRoom);
        if (take <= 0.001)
          return res.status(400).json({ error: "Nothing left to mark ready to dispatch." });
        const readyTotal = roundQty(submittedReadyQty(item) + take);
        const percent = orderQty ? Math.round((readyTotal / orderQty) * 10000) / 100 : 0;
        item.readyPercent = percent;
        item.qcRounds.push({
          readyPercent: percent,
          readyQty: take,
          status: "inspected",
          origin: "order",
          dispatchQty: take,
          rejectedQty: 0,
          scrapQty: 0,
          reworkRemark: "",
          scrapRemark: "",
          skipped: true,
          skipRemark,
          submittedBy: who,
          submittedAt: now,
          inspectedBy: who,
          inspectedAt: now,
        });
        note = `${item.description}: QC skipped for ${take} (not sent for inspection). Reason: ${skipRemark}`;
      } else {
        return res.status(400).json({
          error: "Nothing to skip. No pending QC lots and no remaining quantity.",
        });
      }
    } else {
      return res.status(400).json({ error: "Unknown stage change." });
    }

    order.history.push({ action: "qc-stage", by: who, note, at: now });
    order.markModified("items");
    await order.save();
    res.json(await JobOrder.findById(order._id).lean());
  } catch (err) {
    console.error("[job-orders PATCH /:id/qc-stage] ", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
