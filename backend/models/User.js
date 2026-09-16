const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  username:      { type: String, required: true, unique: true, trim: true, lowercase: true },
  password:      { type: String, required: true },
  plainPassword: { type: String, default: '' },
  role:          { type: String, default: 'viewer', enum: ['admin', 'store', 'store_manager', 'purchase', 'viewer'] }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
