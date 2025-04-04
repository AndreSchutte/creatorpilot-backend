const mongoose = require('mongoose');

const transcriptSchema = new mongoose.Schema({
  text: { type: String, required: true },
  format: { type: String, default: 'youtube' },
  result: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transcript', transcriptSchema);
