function toNum(value) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === "—") return null;
  return text;
}

/** Sort a list by one text field, A–Z or Z–A. Empty values stay at the bottom. */
export function sortText(list, sort, getValue) {
  if (!sort?.key || (sort.dir !== "asc" && sort.dir !== "desc")) return list;
  const sign = sort.dir === "asc" ? 1 : -1;
  return list.slice().sort((a, b) => {
    const av = toText(getValue(a, sort.key));
    const bv = toText(getValue(b, sort.key));
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = av.localeCompare(bv, undefined, { sensitivity: "base", numeric: true });
    if (cmp === 0) return 0;
    return cmp * sign;
  });
}

/** Number or text, based on sort.type. */
export function sortByColumn(list, sort, getValue) {
  if (sort?.type === "text") return sortText(list, sort, getValue);
  return sortNumeric(list, sort, getValue);
}

/** Sort a list by one numeric field. Empty values stay at the bottom. */
export function sortNumeric(list, sort, getValue) {
  if (!sort?.key || (sort.dir !== "asc" && sort.dir !== "desc")) return list;
  const sign = sort.dir === "asc" ? 1 : -1;
  return list.slice().sort((a, b) => {
    const av = toNum(getValue(a, sort.key));
    const bv = toNum(getValue(b, sort.key));
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) return 0;
    return av < bv ? -sign : sign;
  });
}
