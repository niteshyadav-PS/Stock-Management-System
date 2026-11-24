const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
  name:     { type: String, required: true, unique: true, trim: true },
  type:     { type: String, default: '', trim: true },
  code:     { type: String, default: '', trim: true },
  category: { type: String, default: '', trim: true },
  // Display-only Live Stock grouping (Type · Category). Does NOT replace type/category.
  itemGroup: { type: String, default: '', trim: true },
  uom:      { type: String, default: '', trim: true },
  minStock: { type: Number, default: 0, min: 0 },
  // Soft-disable: inactive items stay in history/stock but are hidden from new picks.
  active:   { type: Boolean, default: true },
}, { timestamps: true });

materialSchema.index({ active: 1 });
materialSchema.index({ itemGroup: 1 });

module.exports = mongoose.model('Material', materialSchema);