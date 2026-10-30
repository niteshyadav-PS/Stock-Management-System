const mongoose = require('mongoose');

const JOB_TYPES = ['powder_coating', 'fabrication'];
const MATERIAL_CATEGORIES = ['', 'aluminium', 'ms'];

const jobOrderVendorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, default: '', trim: true },
    jobType: {
      type: String,
      enum: JOB_TYPES,
      required: true,
      index: true,
    },
    // Powder-coating dashboard Aluminium / MS filter (optional for fabrication).
    materialCategory: {
      type: String,
      enum: MATERIAL_CATEGORIES,
      default: '',
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Same company can exist on both powder coating and fabrication lists.
jobOrderVendorSchema.index({ jobType: 1, name: 1 }, { unique: true });

const JobOrderVendor = mongoose.model('JobOrderVendor', jobOrderVendorSchema);
JobOrderVendor.JOB_TYPES = JOB_TYPES;
JobOrderVendor.MATERIAL_CATEGORIES = MATERIAL_CATEGORIES;
module.exports = JobOrderVendor;
