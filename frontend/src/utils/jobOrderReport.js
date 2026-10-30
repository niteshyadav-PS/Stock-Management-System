import {
  vendorMaterialCategory,
  vendorMaterialCategoryLabel,
} from "./jobOrderVendors";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round3(n) {
  return Math.round(num(n) * 1000) / 1000;
}

export function formatReportQty(n) {
  const v = round3(n);
  return Number.isFinite(v) ? String(v) : "—";
}

export function formatReportDate(d) {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  if (!y || !m || !day) return String(d);
  return `${day}/${m}/${y}`;
}

export function jobTypeLabel(type) {
  return type === "fabrication" ? "Fabrication" : "Powder Coating";
}

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function displayName(s, fallback = "—") {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  return t || fallback;
}

function receiptReceivedDate(receipt) {
  if (receipt?.receivedDate) return String(receipt.receivedDate).slice(0, 10);
  if (receipt?.at) return String(receipt.at).slice(0, 10);
  return "";
}

function itemDeliveryDate(item) {
  let best = "";
  for (const receipt of item?.receipts || []) {
    const day = receiptReceivedDate(receipt);
    if (day && (!best || day > best)) best = day;
  }
  return best;
}

function isVendorAcknowledged(order) {
  return !!String(order?.vendorExpectedDate || "").trim();
}

export function submittedReadyQty(item) {
  const total = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.origin === "rework") return sum;
    return sum + num(round.readyQty);
  }, 0);
  return round3(total);
}

export function pendingQcQty(item) {
  const total = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "pending") return sum;
    return sum + num(round.readyQty);
  }, 0);
  return round3(total);
}

export function reworkQty(item) {
  const rejected = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "inspected") return sum;
    return sum + num(round.rejectedQty);
  }, 0);
  const sentBack = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.origin !== "rework") return sum;
    return sum + num(round.readyQty);
  }, 0);
  return Math.max(0, round3(rejected - sentBack));
}

export function scrapQty(item) {
  const total = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "inspected") return sum;
    return sum + num(round.scrapQty);
  }, 0);
  return round3(total);
}

export function readyToDispatchQty(item) {
  const total = (item?.qcRounds || []).reduce((sum, round) => {
    if (round.status !== "inspected") return sum;
    return sum + num(round.dispatchQty);
  }, 0);
  return round3(total);
}

function receivableNow(item) {
  const dispatchLeft = Math.max(
    0,
    readyToDispatchQty(item) - num(item?.receivedQty),
  );
  const orderLeft = Math.max(0, num(item?.qty) - num(item?.receivedQty));
  return round3(Math.min(dispatchLeft, orderLeft));
}

/** Line-level pipeline status (same priority rules as challan dashboard). */
export function linePipelineStatus(totals, order) {
  const orderQty = num(totals.orderQty);
  const ready = num(totals.ready);
  const pending = num(totals.pending);
  const rework = num(totals.rework);
  const scrap = num(totals.scrap);
  const dispatch = num(totals.dispatch);
  const received = num(totals.received);
  const receivable = num(totals.receivable);

  if (orderQty > 0 && received >= orderQty - 0.001) return "Fully received";
  if (order?.status === "received") return "Fully received";
  if (!isVendorAcknowledged(order)) return "Awaiting vendor receive";
  if (pending > 0.001) return "With QC";
  if (rework > 0.001) return "Rework open";
  if (
    scrap > 0.001 &&
    pending <= 0.001 &&
    rework <= 0.001 &&
    receivable <= 0.001
  ) {
    return "Rejected (scrap)";
  }
  if (receivable > 0.001) return "Ready to receive";
  if (dispatch > 0.001 && received < dispatch - 0.001) return "Ready to dispatch";
  if (orderQty > 0 && ready >= orderQty - 0.001) return "Inspection complete";
  if (ready > 0.001) return "In process";
  return "Waiting for vendor qty";
}

export const PIPELINE_STATUSES = [
  "Awaiting vendor receive",
  "Waiting for vendor qty",
  "In process",
  "With QC",
  "Rework open",
  "Rejected (scrap)",
  "Ready to dispatch",
  "Ready to receive",
  "Inspection complete",
  "Fully received",
];

export const REPORT_VIEW_MODES = [
  { id: "challan", label: "By Challan" },
  { id: "item", label: "By Item" },
  { id: "vendor", label: "By Vendor" },
  { id: "project", label: "By Project" },
  { id: "category", label: "By Category" },
];

export const CATEGORY_OPTIONS = [
  { id: "aluminium", label: "Aluminium" },
  { id: "ms", label: "MS" },
  { id: "uncategorized", label: "Uncategorized" },
];

function categoryIdForVendor(vendorName) {
  const id = vendorMaterialCategory(vendorName);
  return id === "aluminium" || id === "ms" ? id : "uncategorized";
}

/**
 * One report row per job-order item line.
 */
export function flattenJobOrdersToItemRows(orders) {
  const rows = [];
  for (const order of orders || []) {
    const jobType =
      order?.jobType === "fabrication" ? "fabrication" : "powder_coating";
    const vendorName = displayName(order?.vendorName);
    const categoryId = categoryIdForVendor(order?.vendorName);
    const categoryLabel =
      vendorMaterialCategoryLabel(order?.vendorName) || "Uncategorized";
    const items = order?.items || [];

    items.forEach((item, itemIndex) => {
      const orderQty = round3(num(item?.qty));
      const ready = submittedReadyQty(item);
      const pending = pendingQcQty(item);
      const dispatch = readyToDispatchQty(item);
      const rework = reworkQty(item);
      const scrap = scrapQty(item);
      const received = round3(num(item?.receivedQty));
      const receivable = receivableNow(item);
      const balance = Math.max(0, round3(orderQty - received));
      const totals = {
        orderQty,
        ready,
        pending,
        dispatch,
        rework,
        scrap,
        received,
        receivable,
      };
      const description = displayName(item?.description, "(No description)");
      const projectName = displayName(item?.projectName, "(No project)");

      rows.push({
        key: `${order._id}-${itemIndex}`,
        orderId: order._id,
        itemIndex,
        srNo: order.srNo || "",
        date: String(order.date || "").slice(0, 10),
        jobType,
        jobTypeLabel: jobTypeLabel(jobType),
        sendFromName: displayName(order?.sendFromName),
        vendorName,
        categoryId,
        categoryLabel,
        projectName,
        description,
        unit: item?.unit || "NOS",
        process: item?.process || "",
        orderQty,
        ready,
        pending,
        dispatch,
        rework,
        scrap,
        received,
        receivable,
        balance,
        expectedDate: String(order.vendorExpectedDate || "").trim().slice(0, 10),
        deliveryDate: itemDeliveryDate(item),
        orderStatus: order.status || "issued",
        acknowledged: isVendorAcknowledged(order),
        pipeline: linePipelineStatus(totals, order),
      });
    });
  }
  return rows;
}

export function filterItemRows(rows, filters = {}) {
  const {
    jobType = "all",
    vendor = "all",
    project = "all",
    item = "",
    category = "all",
    pipeline = "all",
    dateFrom = "",
    dateTo = "",
  } = filters;

  const itemQ = normalizeKey(item);

  return (rows || []).filter((row) => {
    if (jobType !== "all" && row.jobType !== jobType) return false;
    if (vendor !== "all" && normalizeKey(row.vendorName) !== normalizeKey(vendor))
      return false;
    if (
      project !== "all" &&
      normalizeKey(row.projectName) !== normalizeKey(project)
    )
      return false;
    if (category !== "all" && row.categoryId !== category) return false;
    if (pipeline !== "all" && row.pipeline !== pipeline) return false;
    if (dateFrom && (!row.date || row.date < dateFrom)) return false;
    if (dateTo && (!row.date || row.date > dateTo)) return false;
    if (itemQ && !normalizeKey(row.description).includes(itemQ)) return false;
    return true;
  });
}

function emptyTotals() {
  return {
    orderQty: 0,
    ready: 0,
    pending: 0,
    dispatch: 0,
    rework: 0,
    scrap: 0,
    received: 0,
    receivable: 0,
    balance: 0,
  };
}

function addTotals(into, row) {
  into.orderQty = round3(into.orderQty + num(row.orderQty));
  into.ready = round3(into.ready + num(row.ready));
  into.pending = round3(into.pending + num(row.pending));
  into.dispatch = round3(into.dispatch + num(row.dispatch));
  into.rework = round3(into.rework + num(row.rework));
  into.scrap = round3(into.scrap + num(row.scrap));
  into.received = round3(into.received + num(row.received));
  into.receivable = round3(into.receivable + num(row.receivable));
  into.balance = round3(into.balance + num(row.balance));
}

/** Prefer open/in-progress statuses over Fully received when summarizing a group. */
function dominantPipeline(statusCounts) {
  const open = PIPELINE_STATUSES.filter((s) => s !== "Fully received");
  for (const s of open) {
    if (num(statusCounts[s]) > 0) return s;
  }
  if (num(statusCounts["Fully received"]) > 0) return "Fully received";
  return "—";
}

function statusMixLabel(statusCounts) {
  const parts = PIPELINE_STATUSES.map((s) => {
    const c = num(statusCounts[s]);
    return c > 0 ? `${s}: ${c}` : null;
  }).filter(Boolean);
  return parts.join(" · ") || "—";
}

/** Collapse item lines into one row per challan (order). */
export function challanRowsFromItemRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row.orderId || row.key);
    let c = map.get(key);
    if (!c) {
      c = {
        key,
        orderId: row.orderId,
        srNo: row.srNo,
        date: row.date,
        jobType: row.jobType,
        jobTypeLabel: row.jobTypeLabel,
        vendorName: row.vendorName,
        categoryId: row.categoryId,
        categoryLabel: row.categoryLabel,
        sendFromName: row.sendFromName,
        expectedDate: row.expectedDate,
        orderStatus: row.orderStatus,
        acknowledged: row.acknowledged,
        projects: new Map(),
        items: new Map(),
        lineCount: 0,
        statusCounts: {},
        deliveryDate: "",
        ...emptyTotals(),
      };
      map.set(key, c);
    }
    c.lineCount += 1;
    c.statusCounts[row.pipeline] = num(c.statusCounts[row.pipeline]) + 1;
    addTotals(c, row);
    if (row.projectName) {
      c.projects.set(normalizeKey(row.projectName), row.projectName);
    }
    if (row.description) {
      c.items.set(normalizeKey(row.description), row.description);
    }
    if (
      row.deliveryDate &&
      (!c.deliveryDate || row.deliveryDate > c.deliveryDate)
    ) {
      c.deliveryDate = row.deliveryDate;
    }
  }

  return [...map.values()]
    .map((c) => {
      const fakeOrder = {
        status: c.orderStatus,
        vendorExpectedDate: c.acknowledged ? c.expectedDate || "x" : "",
      };
      const pipeline = linePipelineStatus(
        {
          orderQty: c.orderQty,
          ready: c.ready,
          pending: c.pending,
          dispatch: c.dispatch,
          rework: c.rework,
          scrap: c.scrap,
          received: c.received,
          receivable: c.receivable,
        },
        fakeOrder,
      );
      return {
        key: c.key,
        orderId: c.orderId,
        srNo: c.srNo,
        date: c.date,
        jobType: c.jobType,
        jobTypeLabel: c.jobTypeLabel,
        vendorName: c.vendorName,
        categoryLabel: c.categoryLabel,
        sendFromName: c.sendFromName,
        projectNames: [...c.projects.values()],
        projectLabel: [...c.projects.values()].join(", ") || "—",
        itemNames: [...c.items.values()],
        itemLabel: [...c.items.values()].join(", ") || "—",
        lineCount: c.lineCount,
        orderQty: c.orderQty,
        ready: c.ready,
        pending: c.pending,
        dispatch: c.dispatch,
        rework: c.rework,
        scrap: c.scrap,
        received: c.received,
        receivable: c.receivable,
        balance: c.balance,
        expectedDate: c.expectedDate,
        deliveryDate: c.deliveryDate,
        pipeline,
        statusMix: statusMixLabel(c.statusCounts),
      };
    })
    .sort((a, b) => {
      const d = String(b.date || "").localeCompare(String(a.date || ""));
      if (d) return d;
      return String(a.srNo || "").localeCompare(String(b.srNo || ""), undefined, {
        sensitivity: "base",
      });
    });
}

/**
 * Group filtered item rows by view mode.
 * - challan: one row per delivery challan
 * - item / vendor / project / category: aggregated groups
 * For By Item, each group also includes `vendors[]` child breakdown.
 */
export function groupItemRows(rows, viewMode = "challan") {
  const mode = viewMode === "detail" ? "challan" : viewMode || "challan";
  if (mode === "challan") {
    return { mode: "challan", rows: challanRowsFromItemRows(rows) };
  }

  const keyFn = {
    item: (r) => normalizeKey(r.description),
    vendor: (r) => normalizeKey(r.vendorName),
    project: (r) => normalizeKey(r.projectName),
    category: (r) => r.categoryId || "uncategorized",
  }[mode];

  const labelFn = {
    item: (r) => r.description,
    vendor: (r) => r.vendorName,
    project: (r) => r.projectName,
    category: (r) => r.categoryLabel || "Uncategorized",
  }[mode];

  if (!keyFn) return { mode: "challan", rows: challanRowsFromItemRows(rows) };

  const map = new Map();
  for (const row of rows || []) {
    const key = keyFn(row) || "—";
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        label: labelFn(row),
        viewMode: mode,
        challanKeys: new Set(),
        lineCount: 0,
        statusCounts: {},
        vendorsMap: new Map(),
        ...emptyTotals(),
      };
      map.set(key, g);
    }
    g.lineCount += 1;
    g.challanKeys.add(String(row.orderId));
    g.statusCounts[row.pipeline] = num(g.statusCounts[row.pipeline]) + 1;
    addTotals(g, row);

    if (mode === "item") {
      const vk = normalizeKey(row.vendorName);
      let v = g.vendorsMap.get(vk);
      if (!v) {
        v = {
          key: vk,
          vendorName: row.vendorName,
          categoryLabel: row.categoryLabel,
          challanKeys: new Set(),
          lineCount: 0,
          statusCounts: {},
          ...emptyTotals(),
        };
        g.vendorsMap.set(vk, v);
      }
      v.lineCount += 1;
      v.challanKeys.add(String(row.orderId));
      v.statusCounts[row.pipeline] = num(v.statusCounts[row.pipeline]) + 1;
      addTotals(v, row);
    }
  }

  const groups = [...map.values()]
    .map((g) => {
      const vendors = [...(g.vendorsMap?.values() || [])]
        .map((v) => ({
          key: v.key,
          vendorName: v.vendorName,
          categoryLabel: v.categoryLabel,
          challanCount: v.challanKeys.size,
          lineCount: v.lineCount,
          orderQty: v.orderQty,
          ready: v.ready,
          dispatch: v.dispatch,
          received: v.received,
          balance: v.balance,
          rework: v.rework,
          scrap: v.scrap,
          pending: v.pending,
          pipeline: dominantPipeline(v.statusCounts),
          statusMix: statusMixLabel(v.statusCounts),
        }))
        .sort((a, b) =>
          a.vendorName.localeCompare(b.vendorName, undefined, {
            sensitivity: "base",
          }),
        );

      return {
        key: g.key,
        label: g.label,
        viewMode: g.viewMode,
        challanCount: g.challanKeys.size,
        lineCount: g.lineCount,
        orderQty: g.orderQty,
        ready: g.ready,
        pending: g.pending,
        dispatch: g.dispatch,
        rework: g.rework,
        scrap: g.scrap,
        received: g.received,
        receivable: g.receivable,
        balance: g.balance,
        pipeline: dominantPipeline(g.statusCounts),
        statusMix: statusMixLabel(g.statusCounts),
        vendors: mode === "item" ? vendors : undefined,
      };
    })
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    );

  return { mode, groups };
}

/** Unique filter option lists from flat rows. */
export function collectFilterOptions(rows) {
  const vendors = new Map();
  const projects = new Map();
  const items = new Map();
  for (const row of rows || []) {
    if (row.vendorName && row.vendorName !== "—") {
      vendors.set(normalizeKey(row.vendorName), row.vendorName);
    }
    if (row.projectName) {
      projects.set(normalizeKey(row.projectName), row.projectName);
    }
    if (row.description) {
      items.set(normalizeKey(row.description), row.description);
    }
  }
  const sortVals = (map) =>
    [...map.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  return {
    vendors: sortVals(vendors),
    projects: sortVals(projects),
    items: sortVals(items),
  };
}

export function sumItemRows(rows) {
  const t = emptyTotals();
  for (const row of rows || []) addTotals(t, row);
  return t;
}
