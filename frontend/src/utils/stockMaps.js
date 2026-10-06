/**
 * Build O(1) inward/outward qty maps from full entry lists.
 * Prefer this over scanning every row per material name.
 */
export function buildQtyMaps(inwardEntries, outwardEntries) {
  const inMap = new Map();
  const outMap = new Map();
  for (const item of inwardEntries || []) {
    const k = (item?.name || "").trim().toLowerCase();
    if (!k) continue;
    inMap.set(k, (inMap.get(k) || 0) + (Number(item.qty) || 0));
  }
  for (const item of outwardEntries || []) {
    const k = (item?.name || "").trim().toLowerCase();
    if (!k) continue;
    outMap.set(k, (outMap.get(k) || 0) + (Number(item.qty) || 0));
  }
  return { inMap, outMap };
}

export function getBalanceFromMaps(
  name,
  inMap,
  outMap,
  extraQty = 0,
  excludeEntry = null,
) {
  const k = (name || "").trim().toLowerCase();
  if (!k) return 0;
  let outTotal = outMap.get(k) || 0;
  if (excludeEntry && (excludeEntry.name || "").trim().toLowerCase() === k) {
    outTotal -= Number(excludeEntry.qty) || 0;
  }
  return (inMap.get(k) || 0) - outTotal - extraQty;
}

/** Plain object { [materialName]: stock } keyed by original master name. */
export function buildStockByName(master, inwardEntries, outwardEntries) {
  const { inMap, outMap } = buildQtyMaps(inwardEntries, outwardEntries);
  const stockMap = {};
  for (const m of master || []) {
    const k = (m.name || "").trim().toLowerCase();
    stockMap[m.name] = (inMap.get(k) || 0) - (outMap.get(k) || 0);
  }
  return stockMap;
}

/** Balance maps from GET /api/stock/summary (grouped by material, not every row). */
export function summaryToMaps(summary) {
  const inMap = new Map();
  const outMap = new Map();
  const valueMap = new Map();
  const pricedQtyMap = new Map();
  for (const row of summary?.items || []) {
    const k = row.key || (row.name || "").trim().toLowerCase();
    if (!k) continue;
    inMap.set(k, Number(row.inQty) || 0);
    outMap.set(k, Number(row.outQty) || 0);
    valueMap.set(k, Number(row.inValue) || 0);
    const pricedQty =
      row.pricedQty === undefined || row.pricedQty === null
        ? Number(row.inValue) > 0
          ? Number(row.inQty) || 0
          : 0
        : Number(row.pricedQty) || 0;
    pricedQtyMap.set(k, pricedQty);
  }
  return { inMap, outMap, valueMap, pricedQtyMap };
}

export function stockMapFromSummary(master, summary) {
  const { inMap, outMap } = summaryToMaps(summary);
  const stockMap = {};
  for (const m of master || []) {
    const k = (m.name || "").trim().toLowerCase();
    stockMap[m.name] = (inMap.get(k) || 0) - (outMap.get(k) || 0);
  }
  return stockMap;
}

/** One row per material so existing dashboard charts can sum qty / value. */
export function summaryAsInwardRows(summary) {
  return (summary?.items || []).map((it) => ({
    name: it.name,
    qty: Number(it.inQty) || 0,
    price:
      Number(it.pricedQty) > 0 ? (Number(it.inValue) || 0) / Number(it.pricedQty) : 0,
  }));
}

export function summaryAsOutwardRows(summary) {
  return (summary?.items || [])
    .filter((it) => (Number(it.outQty) || 0) > 0)
    .map((it) => ({
      name: it.name,
      qty: Number(it.outQty) || 0,
    }));
}

/** Sort newest entries first (createdAt → date → _id). */
export function sortNewestFirst(a, b) {
  const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (cb !== ca) return cb - ca;
  const da = a.date ? new Date(a.date).getTime() : 0;
  const db = b.date ? new Date(b.date).getTime() : 0;
  if (db !== da) return db - da;
  return String(b._id || "").localeCompare(String(a._id || ""));
}
