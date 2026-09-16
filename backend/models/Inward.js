const mongoose = require('mongoose');

const inwardSchema = new mongoose.Schema({
  date:     { type: String, default: '' },
  invdate:  { type: String, default: '' },
  challan:  { type: String, default: '' },
  po:       { type: String, default: '' },
  vendor:   { type: String, default: '' },
  name:     { type: String, required: true },
  type:     { type: String, default: '' },
  code:     { type: String, default: '' },
  category: { type: String, default: '' },
  uom:      { type: String, default: '' },
  qty:      { type: Number, required: true },
  gin:      { type: String, default: '' },
  by:       { type: String, default: '' },
  location: { type: String, default: '' },
  remarks:  { type: String, default: '' },
  price:    { type: Number, default: 0 }
}, { timestamps: true });

// Indexes for common query patterns
inwardSchema.index({ name: 1 });
inwardSchema.index({ date: -1 });
inwardSchema.index({ category: 1 });
inwardSchema.index({ vendor: 1 });
inwardSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Inward', inwardSchema);
