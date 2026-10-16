const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema({
  qty:          { type: Number, required: true, min: 0.0001 },
  location:     { type: String, required: true },
  receivedBy:   { type: String, default: '' },
  note:         { type: String, default: '' },
  // Calendar day the goods actually arrived (yyyy-mm-dd). Separate from `at`,
  // which is when this receipt was saved. Each partial lot keeps its own date.
  receivedDate: { type: String, default: '' },
  // One id per confirm-received action. Every item in that lot shares it,
  // so each partial receive prints as its own receiving receipt.
  lotId:        { type: String, default: '' },
  challanNo:    { type: String, default: '' },
  at:           { type: Date, default: Date.now },
}, { _id: false });

const qcRoundSchema = new mongoose.Schema({
  readyPercent: { type: Number, required: true, min: 0, max: 100 },
  readyQty:     { type: Number, required: true, min: 0 },
  status:       { type: String, enum: ['pending', 'inspected'], default: 'pending' },
  // order = first submission. rework = quantity QC rejected and the vendor sent back.
  origin:       { type: String, enum: ['order', 'rework'], default: 'order' },
  dispatchQty:  { type: Number, default: 0, min: 0 },
  rejectedQty:  { type: Number, default: 0, min: 0 },
  // Why QC sent this quantity to rework.
  reworkRemark: { type: String, default: '' },
  submittedBy:  { type: String, default: '' },
  submittedAt:  { type: Date, default: null },
  inspectedBy:  { type: String, default: '' },
  inspectedAt:  { type: Date, default: null },
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
  // Latest percent the vendor has sent for inspection (0–100 of this line's qty).
  readyPercent:   { type: Number, default: 0, min: 0, max: 100 },
  // Each time the vendor raises the ready %, a round is opened. QC then splits
  // that new quantity into ready-to-dispatch and rejected. The vendor cannot
  // change the percent while a round is still pending.
  qcRounds:       { type: [qcRoundSchema], default: [] },
}, { _id: false });

const historySchema = new mongoose.Schema({
  action: { type: String, required: true },   // 'issued' | 'received' | 'partial-received' | ...
  by:     { type: String, default: '' },       // frontend sends user?.name || user?.username
  note:   { type: String, default: '' },
  at:     { type: Date, default: Date.now },
}, { _id: false });

const JOB_TYPES = ['powder_coating', 'fabrication'];

const jobOrderSchema = new mongoose.Schema({
  srNo:            { type: String, required: true, trim: true },
  date:            { type: String, required: true },
  // powder_coating | fabrication — same vendor/QC receive flow for both.
  jobType:         { type: String, enum: JOB_TYPES, default: 'powder_coating', index: true },
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
  // Vendor acknowledges the challan when materials arrive at their factory,
  // and sets the date they expect the work to be ready.
  vendorAckAt:       { type: Date, default: null },
  vendorAckBy:       { type: String, default: '' },
  vendorExpectedDate:{ type: String, default: '' }, // yyyy-mm-dd
  vendorAckNote:     { type: String, default: '' },
  history:         { type: [historySchema], default: [] },
  createdByName:     { type: String, default: '' },
  createdByUsername: { type: String, default: '' },
}, { timestamps: true });

jobOrderSchema.index({ srNo: 1 });
jobOrderSchema.index({ createdAt: -1 });
jobOrderSchema.index({ jobType: 1, createdAt: -1 });

const JobOrder = mongoose.model('JobOrder', jobOrderSchema);
JobOrder.JOB_TYPES = JOB_TYPES;
module.exports = JobOrder;