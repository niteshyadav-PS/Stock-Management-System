/**
 * Cascading column-filter helpers.
 * For each column, options come from rows that match every OTHER active filter
 * (Excel-style), so related values stay available while unrelated ones drop out.
 */

export function filterNameKey(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function matchesColFilter(selected, value) {
  if (!selected?.length) return true;
  const key = filterNameKey(value);
  return selected.some((s) => filterNameKey(s) === key);
}

/**
 * @param {object[]} rows
 * @param {Record<string, string[]>} colFilters  map of columnKey -> selected values
 * @param {Record<string, (row) => any>} getters map of columnKey -> value extractor
 * @returns {Record<string, any[]>} raw value lists per column (ColFilter dedupes)
 */
export function buildCascadingColOpts(rows, colFilters, getters) {
  const keys = Object.keys(getters || {});
  const out = {};
  for (const key of keys) {
    const subset = (rows || []).filter((row) =>
      keys.every((k) => {
        if (k === key) return true;
        return matchesColFilter(colFilters?.[k], getters[k](row));
      }),
    );
    out[key] = subset.map((row) => getters[key](row));
  }
  return out;
}

/**
 * Single-select / "all" style filters (report page).
 * For each select key, options come from rows matching every other filter.
 *
 * @param {object[]} rows
 * @param {object} filters current filter values
 * @param {string[]} cascadeKeys keys that participate in cascading
 * @param {(row, filters, excludeKey) => boolean} matchesExcept
 * @param {Record<string, (row) => string>} getters
 * @param {{ sort?: boolean }} [opts]
 */
export function buildCascadingSelectOpts(
  rows,
  filters,
  cascadeKeys,
  matchesExcept,
  getters,
  opts = {},
) {
  const out = {};
  for (const key of cascadeKeys) {
    const subset = (rows || []).filter((row) =>
      matchesExcept(row, filters, key),
    );
    const seen = new Map();
    for (const row of subset) {
      const raw = getters[key](row);
      const label = String(raw ?? "").trim();
      if (!label) continue;
      const nk = filterNameKey(label);
      if (!seen.has(nk)) seen.set(nk, label);
    }
    let list = [...seen.values()];
    if (opts.sort !== false) {
      list = list.sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
    }
    // Keep current selection visible even if it fell out of the cascade set.
    const current = filters?.[key];
    if (
      current &&
      current !== "all" &&
      !list.some((v) => filterNameKey(v) === filterNameKey(current))
    ) {
      list = [current, ...list];
    }
    out[key] = list;
  }
  return out;
}
