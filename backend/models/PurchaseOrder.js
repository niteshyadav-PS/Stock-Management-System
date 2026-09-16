const mongoose = require('mongoose');

const poItemSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  code:       { type: String, default: '' },
  category:   { type: String, default: '' },
  uom:        { type: String, default: '' },
  // Same material can be ordered for different projects — must persist per line
  // so remaining/coverage keys (name||projectName) stay correct.
  projectName:{ type: String, default: '' },
  orderedQty: { type: Number, required: true, min: 0.0001 },
  price:      { type: Number, default: 0 },
  remarks:    { type: String, default: '' },
}, { _id: false });

const changeEntrySchema = new mongoose.Schema({
  field: { type: String, required: true },
  from:  { type: String, default: '' },
  to:    { type: String, default: '' },
}, { _id: false });

const activitySchema = new mongoose.Schema({
  action:          { type: String, required: true }, // 'created' | 'updated'
  description:     { type: String, default: '' },     // used for 'created' summary only
  changes:         { type: [changeEntrySchema], default: [] }, // structured field-level diff for 'updated'
  performedByName: { type: String, default: '' },
  performedByRole: { type: String, default: '' },
  timestamp:       { type: Date, default: Date.now },
}, { _id: false });

const purchaseOrderSchema = new mongoose.Schema({
  poNumber:   { type: String, required: true, trim: true  },
  prNumber:   { type: String, required: true },
  prId:       { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', required: true },
  vendorName: { type: String, required: true, trim: true },
  projectName:      { type: String, default: '' },
  poDate:           { type: String, required: true },
  poExpectedDate:   { type: String, default: '' },
  items:      { type: [poItemSchema], validate: v => Array.isArray(v) && v.length > 0 },
  createdByName:     { type: String, default: '' },
  createdByUsername: { type: String, default: '' },
  activity:   { type: [activitySchema], default: [] },
}, { timestamps: true });

purchaseOrderSchema.index({ prId: 1 });
purchaseOrderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);