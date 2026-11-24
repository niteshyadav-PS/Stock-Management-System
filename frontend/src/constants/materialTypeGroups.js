/** Fixed Type → Category options for display-only Item Group on Live Stock. */
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

/** Stored/display value for the Item Group column. */
export function formatItemGroup(type, category) {
  const t = String(type || "").trim();
  const c = String(category || "").trim();
  if (!t || !c) return "";
  return `${t} · ${c}`;
}
