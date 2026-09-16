const mongoose = require('mongoose');

const outwardSchema = new mongoose.Schema({
  date:     { type: String, default: '' },
  project:  { type: String, default: '' },
  custpo:   { type: String, default: '' },
  slip:     { type: String, default: '' },
  dept:     { type: String, default: '' },
  recby:    { type: String, default: '' },
  by:       { type: String, default: '' },
  name:     { type: String, required: true },
  type:     { type: String, default: '' },
  code:     { type: String, default: '' },
  category: { type: String, default: '' },
  uom:      { type: String, default: '' },
  reqty:    { type: Number, default: null },   // Required Qty — was missing, so Mongoose stripped it
  qty:      { type: Number, required: true },
  remarks:  { type: String, default: '' }

}, { timestamps: true });

// Indexes for common query patterns
outwardSchema.index({ name: 1 });
outwardSchema.index({ date: -1 });
outwardSchema.index({ category: 1 });
outwardSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Outward', outwardSchema);