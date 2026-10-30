const router = require('express').Router();
const JobOrderVendor = require('../models/JobOrderVendor');
const { authMiddleware, requireRole } = require('../middleware/auth');

const JOB_TYPES = JobOrderVendor.JOB_TYPES;
const WRITE_ROLES = ['admin', 'purchase'];
// Job-order screens need the list even when the user cannot edit it.
const READ_ROLES = [
  'admin',
  'purchase',
  'store',
  'store_manager',
  'viewer',
  'quality',
  'vendor',
];

function normalizeJobType(value) {
  const t = String(value || '').trim();
  return JOB_TYPES.includes(t) ? t : '';
}

function normalizeCategory(value) {
  const c = String(value || '').trim().toLowerCase();
  if (c === 'aluminium' || c === 'ms') return c;
  return '';
}

function vendorMatchKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');
}

/** Seed defaults once so existing challan dropdowns keep working. */
const DEFAULT_VENDORS = [
  // Powder coating
  {
    jobType: 'powder_coating',
    name: 'Navdurga Electroplating',
    address:
      'Gala No-17, Classical Ind-Estate-02, Khair Pada, Chaudhari Compound-B, Waliv, Vasai(E), Palghar - 401208',
  },
  {
    jobType: 'powder_coating',
    name: 'Aarti Electroplating',
    address:
      'Gala No Q/12, Sector No.46, Sagar IND.EST. Near Quality Hardware, Dhumal Nagar, Waliv village, Vasai road(E)',
  },
  {
    jobType: 'powder_coating',
    name: 'RN Electroplating',
    address:
      'Shop no.7 Sr.no. 106, Maniccha pada, Vasai, Richard compund, Vasai East - 401208',
  },
  {
    jobType: 'powder_coating',
    name: 'C - Tech Electronics',
    address:
      'Shop No 09, Krushi Plaza, Plot no 15, Sector - 19 Apmc, Vashi, Navi Mumbai - 400705',
    materialCategory: 'ms',
  },
  {
    jobType: 'powder_coating',
    name: 'Quest Enterprises Pvt Ltd',
    address: 'G/140-A, Ansa Industrial Estate, Sakinaka Mumbai 400072',
    materialCategory: 'ms',
  },
  {
    jobType: 'powder_coating',
    name: 'G.K Powder Coating',
    address:
      'Gala No.09/10 Ground Floor, Indian Corporation Bldg No 200, Gundwawali Road, Bhiwandi, Thane - 421302',
    materialCategory: 'aluminium',
  },
  {
    jobType: 'powder_coating',
    name: 'RAPID INDUSTRIES',
    address:
      'F/5,Nand Jyot Indl. Estate, Safed Pool, Sakinaka, Andheri-East, Mumbai-400072',
  },
  {
    jobType: 'powder_coating',
    name: 'Om Darshan Speciality Surfaces Pvt Ltd.',
    address:
      'Plot no.13, Dewan & Sons Industrial Estate Palghar (W) 401404 Maharashtra',
    materialCategory: 'aluminium',
  },
  {
    jobType: 'powder_coating',
    name: 'META COAT',
    address:
      'Ground Floor, H. No. 666/B, Dive Anjur Road Nr. Sricon RMC Plant, Dive Anjur Bhiwandi 421302 Maharashtra',
    materialCategory: 'aluminium',
  },
  {
    jobType: 'powder_coating',
    name: 'SHREE SAI ENTERPRISES',
    address:
      'A-66/4, Anand Nagar MIDC, Additional Ambernath, Ambernath East, 421506 Maharashtra India',
    materialCategory: 'ms',
  },
  {
    jobType: 'powder_coating',
    name: 'Zenco Metal Finisher',
    address:
      'R-714 T.T.C Industrial Area, MIDC Rabale, Navi Mumbai, Maharashtra 400701 India',
    materialCategory: 'ms',
  },
  {
    jobType: 'powder_coating',
    name: 'Fusion Metal Architecture & Innovators',
    address:
      'GROUND FLOOR, SHOP NO.25/A, SAI ASHISH CHS LTD, Bhandup Village Road, Bhandup West, Mumbai, Mumbai Suburban, Maharashtra 400078 India',
    materialCategory: 'ms',
  },
  // Fabrication
  {
    jobType: 'fabrication',
    name: 'Asmee Engineering Industries LLP',
    address:
      'Behind anand cinema, Ground Block No - 10, Sequera Wadi, Sainath Nagar, Kopri, Mumbai, Thane, Maharashtra, 400603',
  },
  {
    jobType: 'fabrication',
    name: 'Moha',
    address:
      'Ground F - 5, Jai Mata di apartment, Balkum Pada No. 1, Balkum Thane - 400608',
  },
  {
    jobType: 'fabrication',
    name: 'C - Tech Electronics',
    address: 'Plot No. W-265 & 266, MIDC, Rabale, Navi Mumbai - 400705',
  },
  {
    jobType: 'fabrication',
    name: 'ZENPACK INNOVATIONS',
    address:
      'PLOT NO. W 95, ADD AMBARNATH INDUSTRIAL AREA, ANAND NAGAR, MIDC, AMBARNATH, Thane, 421503 Maharashtra India',
  },
  {
    jobType: 'fabrication',
    name: 'ASHWA FABTECH',
    address:
      'Plot No PAP-R,294/295/296, HNPE Knowledge, Rabale MIDC, Navi Mumbai, Thane, 400701 Maharashtra India',
  },
  {
    jobType: 'fabrication',
    name: 'HARSHAL ENTERPRISES',
    address:
      'MAYURESHWAR DHAM,FLAT NO 104,C WING, 1ST FLOOR,UMBARDE ROAD,UMBARDE, KALYAN(W)421201 MAHARASHTRA ',
    materialCategory: 'aluminium',
  },
  {
    jobType: 'fabrication',
    name: 'RLP Coating',
    address:
      'Shed No. 3, House No. 2260, Neelima Compound, Opp. Sayali Petrol Pump, NH-8, Vasai Phata, Vasai Road (E),Dist. Palghar – 401208, Maharashtra',
    materialCategory: 'aluminium',
  },
];

async function ensureSeeded() {
  const count = await JobOrderVendor.countDocuments();
  if (count > 0) return { seeded: false, count };
  await JobOrderVendor.insertMany(
    DEFAULT_VENDORS.map((v) => ({
      name: v.name,
      address: v.address || '',
      jobType: v.jobType,
      materialCategory: v.materialCategory || '',
      active: true,
    })),
  );
  return { seeded: true, count: DEFAULT_VENDORS.length };
}

// GET /api/job-order-vendors?jobType=&active=true|false|all&q=
router.get('/', authMiddleware, requireRole(...READ_ROLES), async (req, res) => {
  try {
    await ensureSeeded();
    const filter = {};
    const jobType = normalizeJobType(req.query.jobType);
    if (jobType) filter.jobType = jobType;

    const active = String(req.query.active || 'true').trim().toLowerCase();
    if (active === 'true') filter.active = true;
    else if (active === 'false') filter.active = false;
    // active=all → no active filter

    const q = String(req.query.q || '').trim();
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { address: { $regex: q, $options: 'i' } },
      ];
    }

    const list = await JobOrderVendor.find(filter)
      .sort({ jobType: 1, name: 1 })
      .lean();
    res.json(list);
  } catch (err) {
    console.error('[job-order-vendors GET /] ', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/job-order-vendors
router.post('/', authMiddleware, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    const address = String(req.body.address || '').trim();
    const jobType = normalizeJobType(req.body.jobType);
    const materialCategory = normalizeCategory(req.body.materialCategory);
    const active = req.body.active === false ? false : true;

    if (!name) return res.status(400).json({ error: 'Vendor name is required.' });
    if (!jobType) {
      return res
        .status(400)
        .json({ error: 'Choose Powder Coating or Fabrication.' });
    }

    const created = await JobOrderVendor.create({
      name,
      address,
      jobType,
      materialCategory: jobType === 'powder_coating' ? materialCategory : '',
      active,
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ error: 'This vendor already exists for that job type.' });
    }
    console.error('[job-order-vendors POST /] ', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/job-order-vendors/:id
router.put('/:id', authMiddleware, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    const address = String(req.body.address || '').trim();
    const jobType = normalizeJobType(req.body.jobType);
    const materialCategory = normalizeCategory(req.body.materialCategory);
    const active = req.body.active === false ? false : true;

    if (!name) return res.status(400).json({ error: 'Vendor name is required.' });
    if (!jobType) {
      return res
        .status(400)
        .json({ error: 'Choose Powder Coating or Fabrication.' });
    }

    const updated = await JobOrderVendor.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          name,
          address,
          jobType,
          materialCategory: jobType === 'powder_coating' ? materialCategory : '',
          active,
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) return res.status(404).json({ error: 'Vendor not found.' });
    res.json(updated);
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ error: 'This vendor already exists for that job type.' });
    }
    console.error('[job-order-vendors PUT /:id] ', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/job-order-vendors/:id — soft-deactivate by default; ?hard=1 removes.
router.delete(
  '/:id',
  authMiddleware,
  requireRole(...WRITE_ROLES),
  async (req, res) => {
    try {
      if (String(req.query.hard || '') === '1') {
        await JobOrderVendor.findByIdAndDelete(req.params.id);
        return res.json({ ok: true, removed: true });
      }
      const updated = await JobOrderVendor.findByIdAndUpdate(
        req.params.id,
        { $set: { active: false } },
        { new: true },
      );
      if (!updated) return res.status(404).json({ error: 'Vendor not found.' });
      res.json(updated);
    } catch (err) {
      console.error('[job-order-vendors DELETE /:id] ', err);
      res.status(500).json({ error: err.message });
    }
  },
);

// Exported for tests / other routes if needed.
router.vendorMatchKey = vendorMatchKey;
module.exports = router;
