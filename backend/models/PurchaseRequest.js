const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  type:     { type: String, default: '' },
  code:     { type: String, default: '' },
  category: { type: String, default: '' },
  uom:      { type: String, default: '' },
  qty:      { type: Number, required: true, min: 0.0001 },
  price:    { type: Number, default: 0 },
  expectedDeliveryDate: { type: String, default: '' }, // stored as "YYYY-MM-DD"
  projectName: { type: String, default: '' },
  remarks:  { type: String, default: '' },
}, { _id: false });

const historySchema = new mongoose.Schema({
  status: { type: String, required: true },
  byName:     { type: String, default: '' },
  byUsername: { type: String, default: '' },
  note:   { type: String, default: '' },
  at:     { type: Date, default: Date.now },
}, { _id: false });

const purchaseRequestSchema = new mongoose.Schema({
  prNumber: { type: String, required: true, unique: true },
  date:     { type: String, required: true },

  projectName:  { type: String, default: '' },
  requestFrom:  { type: String, default: '' },

  requestedByName:     { type: String, required: true },
  requestedByUsername: { type: String, required: true },

  items:   { type: [itemSchema], validate: v => Array.isArray(v) && v.length > 0 },
  remarks: { type: String, default: '' },

  status: {
    type: String,
    enum: ['pending', 'approved', 'partial', 'rejected', 'ordered', 'received'],
    default: 'pending',
  },

  // Populated as the request moves through the lifecycle
  approvedByName: { type: String, default: '' },
  approvedAt:     { type: Date, default: null },
  rejectReason:   { type: String, default: '' },

  poNumber:  { type: String, default: '' },
  vendor:    { type: String, default: '' },
  orderedAt: { type: Date, default: null },

  receivedAt: { type: Date, default: null },

  history: { type: [historySchema], default: [] },
}, { timestamps: true });

purchaseRequestSchema.index({ status: 1 });
purchaseRequestSchema.index({ requestedByUsername: 1 });
purchaseRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PurchaseRequest', purchaseRequestSchema);