/** Fixed Type → Category options for display-only Sub Category on Live Stock. */
export const MATERIAL_TYPE_CATEGORY_MAP = {
  "RAW MATERIALS": [
    "Box Pipe",
    "C strut",
    "Plastics sheet",
    "Aluminium",
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

/** Stored value still keeps Type · Category so Item Group can be derived. */
export function formatSubCategory(type, category) {
  const t = String(type || "").trim();
  const c = String(category || "").trim();
  if (!t || !c) return "";
  return `${t} · ${c}`;
}

/** Raw stored sub-category string (may be "Type · Category" or category only). */
function rawSubCategory(row) {
  const sub = String(row?.subCategory || "").trim();
  if (sub) return sub;
  const legacy = String(row?.itemGroup || "").trim();
  if (legacy.includes("·") || legacy.includes(" - ")) return legacy;
  return "";
}

function splitGroupParts(value) {
  const raw = String(value || "").trim();
  if (!raw) return { type: "", category: "" };
  if (raw.includes("·")) {
    const [type, ...rest] = raw.split("·");
    return { type: type.trim(), category: rest.join("·").trim() };
  }
  if (raw.includes(" - ")) {
    const [type, ...rest] = raw.split(" - ");
    return { type: type.trim(), category: rest.join(" - ").trim() };
  }
  return { type: "", category: raw };
}

/**
 * Sub Category column = category only (e.g. FCG Accessories, Bolts).
 * Strips leading type from "TYPE · Category" / "TYPE - Category".
 */
export function getSubCategory(row) {
  const { category } = splitGroupParts(rawSubCategory(row));
  return category;
}

/**
 * Item Group = chart type only (e.g. RAW MATERIALS / ACCESSORIES).
 */
export function getItemGroup(row) {
  const stored = String(row?.itemGroup || "").trim();
  if (stored && !stored.includes("·") && !stored.includes(" - ")) return stored;
  const fromRaw = splitGroupParts(rawSubCategory(row)).type;
  if (fromRaw) return fromRaw;
  if (stored.includes("·") || stored.includes(" - ")) {
    return splitGroupParts(stored).type;
  }
  return stored || "";
}
