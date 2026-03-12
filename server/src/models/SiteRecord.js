const mongoose = require('mongoose');

/**
 * SiteRecord - Storage-efficient per-domain aggregation.
 * One document per domain. Keeps last 20 article refs (no content).
 * ~4-5 KB per site, supports 100k+ sites within 512 MB budget.
 */
const articleRefSchema = new mongoose.Schema(
  {
    url:        { type: String, trim: true, default: '' },
    title:      { type: String, trim: true, maxlength: 120, default: '' },
    verdict:    { type: String, enum: ['REAL', 'FAKE', 'UNCERTAIN', 'SATIRE'], required: true },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    scannedAt:  { type: Date, default: Date.now },
  },
  { _id: false }
);

const siteRecordSchema = new mongoose.Schema(
  {
    domain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    totalScans:    { type: Number, default: 0 },
    fakeCount:     { type: Number, default: 0 },
    realCount:     { type: Number, default: 0 },
    uncertainCount:{ type: Number, default: 0 },
    satirCount:    { type: Number, default: 0 },
    // Precomputed: (fakeCount / totalScans) * 100, updated on every upsert
    fakeScore:     { type: Number, default: 0, index: true },
    // Last 20 article refs — older entries auto-trimmed via $slice
    articles: { type: [articleRefSchema], default: [] },
    lastScannedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

siteRecordSchema.index({ fakeScore: -1 });
siteRecordSchema.index({ totalScans: -1 });

module.exports = mongoose.model('SiteRecord', siteRecordSchema);
