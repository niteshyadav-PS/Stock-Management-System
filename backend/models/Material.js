const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
  name:     { type: String, required: true, unique: true, trim: true },
  type:     { type: String, default: '', trim: true },
  code:     { type: String, default: '', trim: true },
  category: { type: String, default: '', trim: true },
  // Display-only Live Stock fields. Do NOT replace type/category.
  // itemGroup = chart type only (e.g. RAW MATERIALS)
  // subCategory = type · category (e.g. RAW MATERIALS · Box Pipe)
  itemGroup: { type: String, default: '', trim: true },
  subCategory: { type: String, default: '', trim: true },
  uom:      { type: String, default: '', trim: true },
  minStock: { type: Number, default: 0, min: 0 },
  // Soft-disable: inactive items stay in history/stock but are hidden from new picks.
  active:   { type: Boolean, default: true },
}, { timestamps: true });

materialSchema.index({ active: 1 });
materialSchema.index({ itemGroup: 1 });
materialSchema.index({ subCategory: 1 });

module.exports = mongoose.model('Material', materialSchema);