const mongoose = require('mongoose');

// Generic atomic counter — used to generate sequential, gap-free
// human-readable numbers (e.g. PR-0001) without race conditions.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. 'purchaseRequest'
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

// Atomically increments and returns the next sequence number for `key`.
async function nextSeq(key) {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return doc.seq;
}

module.exports = { Counter, nextSeq };
