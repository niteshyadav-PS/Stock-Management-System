const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema({
  qty:        { type: Number, required: true, min: 0.0001 },
  location:   { type: String, required: true },
  receivedBy: { type: String, default: '' },
  note:       { type: String, default: '' },
  at:         { type: Date, default: Date.now },
}, { _id: false });

const joItemSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true },

  // Numeric fields default to null (not 0) so "left blank" stays
  // distinguishable from "entered as zero" all the way to the UI.
  weightPerPc: { type: Number, default: null },
  perimeter:   { type: Number, default: null },
  length:      { type: Number, default: null },
  // Server-computed from perimeter × length ÷ 645.2 — never trust a
  // client-supplied area value, it's a live-preview-only figure on the frontend.
  area:        { type: Number, default: null },

  qty:         { type: Number, required: true, min: 0.0001 },
  unit:        { type: String, default: 'NOS' },
  process:     { type: String, default: '' },
  projectName: { type: String, required: true, trim: true },
  // ralCode:     { type: String, default: '' },

  receivedQty: { type: Number, default: 0, min: 0 },   // sum of all receipts, clamped to qty
  receipts:    { type: [receiptSchema], default: [] }, // per-location receiving history for this item
  remark:      { type: String, default: '' },
}, { _id: false });

const historySchema = new mongoose.Schema({
  action: { type: String, required: true },   // 'issued' | 'received' | 'partial-received' | ...
  by:     { type: String, default: '' },       // frontend sends user?.name || user?.username
  note:   { type: String, default: '' },
  at:     { type: Date, default: Date.now },
}, { _id: false });

const jobOrderSchema = new mongoose.Schema({
  srNo:            { type: String, required: true, trim: true },
  date:            { type: String, required: true },
  sendFromName:    { type: String, default: '' },
  sendFromAddress: { type: String, default: '' },
  vendorName:      { type: String, required: true, trim: true },
  vehicleNo:       { type: String, default: '' },
  issuedBy:        { type: String, required: true, trim: true },
  deliveryAddress: { type: String, default: '' },
  remarks:         { type: String, default: '' },
  items:           { type: [joItemSchema], validate: v => Array.isArray(v) && v.length > 0 },
  status:          { type: String, enum: ['issued', 'partial', 'received'], default: 'issued' },
  receivedAt:      { type: String, default: '' },  // location: Factory / Site / Multiple locations
  receivedBy:      { type: String, default: '' },
  challanNo:       { type: String, default: '' },  // vendor's delivery challan no., captured when marking received
  history:         { type: [historySchema], default: [] },
  createdByName:     { type: String, default: '' },
  createdByUsername: { type: String, default: '' },
}, { timestamps: true });

jobOrderSchema.index({ srNo: 1 });
jobOrderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('JobOrder', jobOrderSchema);