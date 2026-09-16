const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
  name:     { type: String, required: true, unique: true, trim: true },
  type:     { type: String, default: '', trim: true },
  code:     { type: String, default: '', trim: true },
  category: { type: String, default: '', trim: true },
  uom:      { type: String, default: '', trim: true },
  minStock: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Material', materialSchema);