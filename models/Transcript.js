const mongoose = require('mongoose');

const TranscriptSchema = new mongoose.Schema({
  text: String,
  format: String,
  result: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Transcript', TranscriptSchema);
