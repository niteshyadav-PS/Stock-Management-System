/** Fixed Type → Category options for display-only Sub Category on Live Stock. */
export const MATERIAL_TYPE_CATEGORY_MAP = {
  "RAW MATERIALS": [
    "Box Pipe",
    "C strut",
    "Plastics sheet",
    "Alumin",
    "MS sheets",
    "Gasket",
    "Wiremesh",
  ],
  HARDWARE: [
    "Nuts",
    "Bolts",
    "Screws",
    "washer",
    "Threaded Rod",
    "fasteners",
  ],
  ACCESSORIES: [
    "Gaspump",
    "FCG Accessories",
    "Door Accessories",
    "Stickers",
  ],
  CONSUMABLE: [
    "Welding Wires",
    "Wrapping Roll",
    "Griding wheels",
    "Flap wheels",
    "All Packing and inhouse using materials",
  ],
};

export const MATERIAL_TYPES = Object.keys(MATERIAL_TYPE_CATEGORY_MAP);

export function categoriesForType(type) {
  return MATERIAL_TYPE_CATEGORY_MAP[type] || [];
}

/** Stored/display value for the Sub Category column. */
export function formatSubCategory(type, category) {
  const t = String(type || "").trim();
  const c = String(category || "").trim();
  if (!t || !c) return "";
  return `${t} · ${c}`;
}

/** Read sub category (Type · Category). */
export function getSubCategory(row) {
  return String(row?.subCategory || "").trim();
}

/**
 * Item Group = chart type only (e.g. RAW MATERIALS).
 * Prefer stored itemGroup; otherwise parse from subCategory.
 */
export function getItemGroup(row) {
  const stored = String(row?.itemGroup || "").trim();
  if (stored && !stored.includes("·")) return stored;
  const sub = getSubCategory(row) || stored;
  if (!sub) return "";
  if (sub.includes("·")) return sub.split("·")[0].trim();
  return sub;
}
