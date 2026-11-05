const mongoose = require('mongoose');

const inwardVendorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    address: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('InwardVendor', inwardVendorSchema);
