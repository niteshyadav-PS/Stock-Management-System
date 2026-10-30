/** Fallback presets when Vendor Master API is unavailable. */
export const POWDER_COATING_VENDORS = [
  {
    name: "Navdurga Electroplating",
    address:
      "Gala No-17, Classical Ind-Estate-02, Khair Pada, Chaudhari Compound-B, Waliv, Vasai(E), Palghar - 401208",
  },
  {
    name: "Aarti Electroplating",
    address:
      "Gala No Q/12, Sector No.46, Sagar IND.EST. Near Quality Hardware, Dhumal Nagar, Waliv village, Vasai road(E)",
  },
  {
    name: "RN Electroplating",
    address:
      "Shop no.7 Sr.no. 106, Maniccha pada, Vasai, Richard compund, Vasai East - 401208",
  },
  {
    name: "C - Tech Electronics",
    address:
      "Shop No 09, Krushi Plaza, Plot no 15, Sector - 19 Apmc, Vashi, Navi Mumbai - 400705",
    materialCategory: "ms",
  },
  {
    name: "Quest Enterprises Pvt Ltd",
    address: "G/140-A, Ansa Industrial Estate, Sakinaka Mumbai 400072",
    materialCategory: "ms",
  },
  {
    name: "G.K Powder Coating",
    address:
      "Gala No.09/10 Ground Floor, Indian Corporation Bldg No 200, Gundwawali Road, Bhiwandi, Thane - 421302",
    materialCategory: "aluminium",
  },
  {
    name: "RAPID INDUSTRIES",
    address:
      "F/5,Nand Jyot Indl. Estate, Safed Pool, Sakinaka, Andheri-East, Mumbai-400072",
  },
  {
    name: "Om Darshan Speciality Surfaces Pvt Ltd.",
    address:
      "Plot no.13, Dewan & Sons Industrial Estate Palghar (W) 401404 Maharashtra",
    materialCategory: "aluminium",
  },
  {
    name: "META COAT",
    address:
      "Ground Floor, H. No. 666/B, Dive Anjur Road Nr. Sricon RMC Plant, Dive Anjur Bhiwandi 421302 Maharashtra",
    materialCategory: "aluminium",
  },
  {
    name: "SHREE SAI ENTERPRISES",
    address:
      "A-66/4, Anand Nagar MIDC, Additional Ambernath, Ambernath East, 421506 Maharashtra India",
    materialCategory: "ms",
  },
  {
    name: "Zenco Metal Finisher",
    address:
      "R-714 T.T.C Industrial Area, MIDC Rabale, Navi Mumbai, Maharashtra 400701 India",
    materialCategory: "ms",
  },
  {
    name: "Fusion Metal Architecture & Innovators",
    address:
      "GROUND FLOOR, SHOP NO.25/A, SAI ASHISH CHS LTD, Bhandup Village Road, Bhandup West, Mumbai, Mumbai Suburban, Maharashtra 400078 India",
    materialCategory: "ms",
  },
];

export const FABRICATION_VENDORS = [
  {
    name: "Asmee Engineering Industries LLP",
    address:
      "Behind anand cinema, Ground Block No - 10, Sequera Wadi, Sainath Nagar, Kopri, Mumbai, Thane, Maharashtra, 400603",
  },
  {
    name: "Moha",
    address:
      "Ground F - 5, Jai Mata di apartment, Balkum Pada No. 1, Balkum Thane - 400608",
  },
  {
    name: "C - Tech Electronics",
    address:
      "Plot No. W-265 & 266, MIDC, Rabale, Navi Mumbai - 400705",
  },
  {
    name: "ZENPACK INNOVATIONS",
    address:
      "PLOT NO. W 95, ADD AMBARNATH INDUSTRIAL AREA, ANAND NAGAR, MIDC, AMBARNATH, Thane, 421503 Maharashtra India",
  },
  {
    name: "ASHWA FABTECH",
    address:
      "Plot No PAP-R,294/295/296, HNPE Knowledge, Rabale MIDC, Navi Mumbai, Thane, 400701 Maharashtra India",
  },
  {
    name: "HARSHAL ENTERPRISES",
    address:
      "MAYURESHWAR DHAM,FLAT NO 104,C WING, 1ST FLOOR,UMBARDE ROAD,UMBARDE, KALYAN(W)421201 MAHARASHTRA ",
    materialCategory: "aluminium",
  },
  {
    name: "RLP Coating",
    address:
      "Shed No. 3, House No. 2260, Neelima Compound, Opp. Sayali Petrol Pump, NH-8, Vasai Phata, Vasai Road (E),Dist. Palghar – 401208, Maharashtra",
    materialCategory: "aluminium",
  },
];

/** In-memory Vendor Master cache (filled by pages after GET /job-order-vendors). */
let _vendorCache = null;

export function setJobOrderVendorsCache(list) {
  _vendorCache = Array.isArray(list) ? list : null;
}

export function getJobOrderVendorsCache() {
  return _vendorCache;
}

function fallbackVendors(jobType) {
  return jobType === "fabrication" ? FABRICATION_VENDORS : POWDER_COATING_VENDORS;
}

export function vendorsForJobType(jobType) {
  if (_vendorCache?.length) {
    return _vendorCache
      .filter(
        (v) =>
          v.jobType === jobType &&
          v.active !== false &&
          String(v.name || "").trim(),
      )
      .map((v) => ({
        name: v.name,
        address: v.address || "",
        materialCategory: v.materialCategory || "",
        _id: v._id,
      }));
  }
  return fallbackVendors(jobType);
}

export function vendorNamesForJobType(jobType) {
  return vendorsForJobType(jobType).map((v) => v.name);
}

export function jobTypeLabel(jobType) {
  return jobType === "fabrication" ? "Fabrication" : "Powder Coating";
}

/** Powder-coating vendor material category (Aluminium / MS). */
export const VENDOR_MATERIAL_CATEGORIES = [
  { id: "aluminium", label: "Aluminium" },
  { id: "ms", label: "MS" },
];

/**
 * Match tokens per category — covers common spelling variants on challans
 * (spaces, punctuation, short names like "C-Tech", "Fusion coating").
 */
const VENDOR_CATEGORY_MATCHERS = {
  aluminium: [
    "gkpowder",
    "gkpodercoating",
    "metacoat",
    "harshan",
    "rlpcoat",
    "omdarshan",
  ],
  ms: [
    "questenterprises",
    "ctech",
    "toros",
    "zencometal",
    "zenco",
    "shreesai",
    "fusionmetal",
    "fusioncoating",
  ],
};

function vendorMatchKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "");
}

function categoryFromCache(vendorName) {
  if (!_vendorCache?.length) return "";
  const key = vendorMatchKey(vendorName);
  if (!key) return "";
  let best = { cat: "", len: 0 };
  for (const v of _vendorCache) {
    if (!v.materialCategory) continue;
    const vk = vendorMatchKey(v.name);
    if (!vk) continue;
    if (key === vk || key.includes(vk) || vk.includes(key)) {
      const len = Math.min(key.length, vk.length);
      if (len > best.len) best = { cat: v.materialCategory, len };
    }
  }
  return best.cat === "aluminium" || best.cat === "ms" ? best.cat : "";
}

/**
 * Resolve Aluminium / MS for a vendor name. Returns "" when unknown.
 * Prefers Vendor Master category when cached; else token matchers.
 */
export function vendorMaterialCategory(vendorName) {
  const fromMaster = categoryFromCache(vendorName);
  if (fromMaster) return fromMaster;

  const key = vendorMatchKey(vendorName);
  if (!key) return "";

  let best = { id: "", len: 0 };
  for (const { id } of VENDOR_MATERIAL_CATEGORIES) {
    for (const token of VENDOR_CATEGORY_MATCHERS[id] || []) {
      if (!token || token.length < 3 || token.length < best.len) continue;
      if (key.includes(token)) best = { id, len: token.length };
    }
  }
  return best.id;
}

export function vendorMaterialCategoryLabel(vendorName) {
  const id = vendorMaterialCategory(vendorName);
  return VENDOR_MATERIAL_CATEGORIES.find((c) => c.id === id)?.label || "";
}
