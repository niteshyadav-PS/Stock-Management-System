const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  username:      { type: String, required: true, unique: true, trim: true, lowercase: true },
  password:      { type: String, required: true },
  plainPassword: { type: String, default: '' },
  role:          { type: String, default: 'viewer', enum: ['admin', 'store', 'store_manager', 'purchase', 'accounts', 'viewer', 'vendor', 'quality'] },
  // Set only for role "vendor". Must match JobOrder.vendorName so the login
  // sees just that company's assigned materials.
  vendorName:    { type: String, default: '', trim: true },
  // Vendor logins are scoped to one flow: powder_coating or fabrication.
  vendorJobType: { type: String, enum: ['', 'powder_coating', 'fabrication'], default: '' },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
