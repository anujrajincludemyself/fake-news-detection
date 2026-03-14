const SiteRecord = require('../models/SiteRecord');
const WallTrendingService = require('../services/wallTrendingService');

/**
 * @desc  Get all site records for the Wall of Fake
 * @route GET /api/wall
 * @access Public
 */
exports.getWall = async (req, res, next) => {
  try {
    // Show all sites with at least 1 scan
    const sites = await SiteRecord.find({ totalScans: { $gte: 1 } })
      .sort({ fakeScore: -1, totalScans: -1 })
      .select('-articles.url -__v')   // keep article titles/verdicts, drop full URLs for brevity
      .lean();

    // Re-attach only necessary article fields to save payload size
    const lean = sites.map((s) => ({
      domain:        s.domain,
      totalScans:    s.totalScans,
      fakeCount:     s.fakeCount,
      realCount:     s.realCount,
      uncertainCount:s.uncertainCount,
      satirCount:    s.satirCount,
      fakeScore:     s.fakeScore,
      lastScannedAt: s.lastScannedAt,
      // Include last 5 article refs (title + verdict only) for the UI cards
      recentArticles: (s.articles || [])
        .slice(-5)
        .reverse()
        .map((a) => ({ title: a.title, verdict: a.verdict, confidence: a.confidence, scannedAt: a.scannedAt })),
    }));

    res.status(200).json({ success: true, data: lean });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc  Get hourly trending rumor for Wall of Fake hero section
 * @route GET /api/wall/trending-rumor
 * @access Public
 */
exports.getTrendingRumor = async (req, res, next) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const data = await WallTrendingService.getHourlyTrendingRumor({ forceRefresh });

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
