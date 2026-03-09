const SiteRecord = require('../models/SiteRecord');
const logger = require('../utils/logger');

/**
 * Record one scan result for a domain.
 * Called inside the same request after analysis — NOT a separate API call.
 *
 * @param {object} opts
 * @param {string} opts.domain   - e.g. "ndtv.com"
 * @param {string} opts.url      - full article URL
 * @param {string} opts.title    - article headline (truncated to 120 chars)
 * @param {string} opts.verdict  - REAL | FAKE | UNCERTAIN | SATIRE
 * @param {number} opts.confidence
 */
async function recordScan({ domain, url, title, verdict, confidence }) {
  if (!domain || !verdict) return;

  const verdictKey = {
    REAL:      'realCount',
    FAKE:      'fakeCount',
    UNCERTAIN: 'uncertainCount',
    SATIRE:    'satirCount',
  }[verdict] || 'uncertainCount';

  const articleRef = {
    url:        (url || '').slice(0, 500),
    title:      (title || '').slice(0, 120),
    verdict,
    confidence: Math.round(Number(confidence) || 0),
    scannedAt:  new Date(),
  };

  try {
    // Single atomic pipeline update — increments counts, appends article,
    // AND recomputes fakeScore all in one DB round-trip (no race condition).
    const incFields = {
      totalScans:    { $add: [{ $ifNull: ['$totalScans',    0] }, 1] },
      fakeCount:     verdictKey === 'fakeCount'     ? { $add: [{ $ifNull: ['$fakeCount',     0] }, 1] } : { $ifNull: ['$fakeCount',     0] },
      realCount:     verdictKey === 'realCount'     ? { $add: [{ $ifNull: ['$realCount',     0] }, 1] } : { $ifNull: ['$realCount',     0] },
      uncertainCount:verdictKey === 'uncertainCount'? { $add: [{ $ifNull: ['$uncertainCount',0] }, 1] } : { $ifNull: ['$uncertainCount',0] },
      satirCount:    verdictKey === 'satirCount'    ? { $add: [{ $ifNull: ['$satirCount',    0] }, 1] } : { $ifNull: ['$satirCount',    0] },
    };

    await SiteRecord.findOneAndUpdate(
      { domain: domain.toLowerCase() },
      [
        {
          $set: {
            ...incFields,
            articles: {
              $slice: [
                { $concatArrays: [{ $ifNull: ['$articles', []] }, [articleRef]] },
                -20,
              ],
            },
            lastScannedAt: new Date(),
          },
        },
        {
          // Stage 2 sees the already-incremented values from stage 1
          $set: {
            fakeScore: {
              $cond: [
                { $gt: ['$totalScans', 0] },
                { $toInt: { $round: [{ $multiply: [{ $divide: ['$fakeCount', '$totalScans'] }, 100] }, 0] } },
                0,
              ],
            },
          },
        },
      ],
      { upsert: true }
    );
  } catch (err) {
    // Non-fatal — don't let recording failure break analysis response
    logger.error(`SiteRecorder error for ${domain}: ${err.message}`);
  }
}

module.exports = { recordScan };
