const SiteRecord = require('../models/SiteRecord');

const SORT_MAP = {
  fakeScore_desc:  { fakeScore: -1, totalScans: -1 },
  fakeScore_asc:   { fakeScore:  1, totalScans: -1 },
  totalScans_desc: { totalScans: -1, fakeScore: -1 },
  domain_asc:      { domain: 1 },
};

function riskLevel(fakeScore) {
  if (fakeScore >= 70) return 'HIGH';
  if (fakeScore >= 40) return 'MODERATE';
  return 'LOW';
}

/**
 * @desc  Get paginated, sorted site rankings based on fake-news percentage
 * @route GET /api/ranking
 * @access Public
 * @query {number} page         - Page number (default: 1)
 * @query {number} limit        - Results per page (default: 20, max: 100)
 * @query {number} minScans     - Minimum scan count to include a site (default: 1)
 * @query {string} sort         - fakeScore_desc | fakeScore_asc | totalScans_desc | domain_asc
 */
exports.getRankings = async (req, res, next) => {
  try {
    const page     = Math.max(1,   parseInt(req.query.page)     || 1);
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit)    || 20));
    const minScans = Math.max(1,   parseInt(req.query.minScans) || 1);
    const sortKey  = req.query.sort && SORT_MAP[req.query.sort]
      ? req.query.sort
      : 'fakeScore_desc';

    const filter = { totalScans: { $gte: minScans } };

    const [total, sites] = await Promise.all([
      SiteRecord.countDocuments(filter),
      SiteRecord.find(filter)
        .sort(SORT_MAP[sortKey])
        .skip((page - 1) * limit)
        .limit(limit)
        .select('-articles -__v')
        .lean(),
    ]);

    const rankOffset = (page - 1) * limit;
    const data = sites.map((s, i) => ({
      rank:          rankOffset + i + 1,
      domain:        s.domain,
      totalScans:    s.totalScans,
      fakeCount:     s.fakeCount,
      realCount:     s.realCount,
      uncertainCount:s.uncertainCount,
      satirCount:    s.satirCount,
      fakeScore:     s.fakeScore,
      trustScore:    parseFloat((100 - s.fakeScore).toFixed(1)),
      riskLevel:     riskLevel(s.fakeScore),
      lastScannedAt: s.lastScannedAt,
    }));

    res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc  Get overall ranking statistics (risk breakdown, aggregates)
 * @route GET /api/ranking/stats
 * @access Public
 */
exports.getRankingStats = async (req, res, next) => {
  try {
    const [aggregate, riskCounts] = await Promise.all([
      SiteRecord.aggregate([
        { $match: { totalScans: { $gte: 1 } } },
        {
          $group: {
            _id:          null,
            totalSites:   { $sum: 1 },
            totalScans:   { $sum: '$totalScans' },
            totalFake:    { $sum: '$fakeCount' },
            totalReal:    { $sum: '$realCount' },
            avgFakeScore: { $avg: '$fakeScore' },
            maxFakeScore: { $max: '$fakeScore' },
            minFakeScore: { $min: '$fakeScore' },
          },
        },
      ]),
      SiteRecord.aggregate([
        { $match: { totalScans: { $gte: 1 } } },
        {
          $group: {
            _id: {
              $switch: {
                branches: [
                  { case: { $gte: ['$fakeScore', 70] }, then: 'HIGH' },
                  { case: { $gte: ['$fakeScore', 40] }, then: 'MODERATE' },
                ],
                default: 'LOW',
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const stats = aggregate[0] || {
      totalSites: 0, totalScans: 0, totalFake: 0, totalReal: 0,
      avgFakeScore: 0, maxFakeScore: 0, minFakeScore: 0,
    };

    const riskBreakdown = { HIGH: 0, MODERATE: 0, LOW: 0 };
    riskCounts.forEach(({ _id, count }) => { if (_id) riskBreakdown[_id] = count; });

    res.status(200).json({
      success: true,
      data: {
        totalSites:   stats.totalSites,
        totalScans:   stats.totalScans,
        totalFake:    stats.totalFake,
        totalReal:    stats.totalReal,
        avgFakeScore: parseFloat((stats.avgFakeScore || 0).toFixed(1)),
        maxFakeScore: parseFloat((stats.maxFakeScore || 0).toFixed(1)),
        minFakeScore: parseFloat((stats.minFakeScore || 0).toFixed(1)),
        riskBreakdown,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc  Get the top N sites with the highest fake-news percentage
 * @route GET /api/ranking/top-fake
 * @access Public
 * @query {number} limit    - Number of results (default: 10, max: 50)
 * @query {number} minScans - Minimum scans required (default: 2)
 */
exports.getTopFake = async (req, res, next) => {
  try {
    const limit    = Math.min(50, Math.max(1, parseInt(req.query.limit)    || 10));
    const minScans = Math.max(1,             parseInt(req.query.minScans) || 2);

    const sites = await SiteRecord.find({ totalScans: { $gte: minScans } })
      .sort({ fakeScore: -1, totalScans: -1 })
      .limit(limit)
      .select('-articles -__v')
      .lean();

    const data = sites.map((s, i) => ({
      rank:          i + 1,
      domain:        s.domain,
      totalScans:    s.totalScans,
      fakeCount:     s.fakeCount,
      fakeScore:     s.fakeScore,
      riskLevel:     riskLevel(s.fakeScore),
      lastScannedAt: s.lastScannedAt,
    }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc  Get the top N most reliable sites (lowest fake-news percentage)
 * @route GET /api/ranking/most-reliable
 * @access Public
 * @query {number} limit    - Number of results (default: 10, max: 50)
 * @query {number} minScans - Minimum scans required (default: 2)
 */
exports.getMostReliable = async (req, res, next) => {
  try {
    const limit    = Math.min(50, Math.max(1, parseInt(req.query.limit)    || 10));
    const minScans = Math.max(1,             parseInt(req.query.minScans) || 2);

    const sites = await SiteRecord.find({ totalScans: { $gte: minScans } })
      .sort({ fakeScore: 1, totalScans: -1 })
      .limit(limit)
      .select('-articles -__v')
      .lean();

    const data = sites.map((s, i) => ({
      rank:          i + 1,
      domain:        s.domain,
      totalScans:    s.totalScans,
      realCount:     s.realCount,
      fakeScore:     s.fakeScore,
      trustScore:    parseFloat((100 - s.fakeScore).toFixed(1)),
      lastScannedAt: s.lastScannedAt,
    }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc  Get the ranking position and full breakdown for a specific domain
 * @route GET /api/ranking/site/:domain
 * @access Public
 */
exports.getSiteRank = async (req, res, next) => {
  try {
    const domain = req.params.domain.toLowerCase().trim();

    const site = await SiteRecord.findOne({ domain }).select('-__v').lean();
    if (!site) {
      return res.status(404).json({ success: false, message: 'Domain not found in rankings' });
    }

    // Rank = number of sites with a strictly higher fakeScore (tie-broken by totalScans) + 1
    const [rank, totalSites] = await Promise.all([
      SiteRecord.countDocuments({
        totalScans: { $gte: 1 },
        $or: [
          { fakeScore: { $gt: site.fakeScore } },
          { fakeScore: site.fakeScore, totalScans: { $gt: site.totalScans } },
        ],
      }),
      SiteRecord.countDocuments({ totalScans: { $gte: 1 } }),
    ]);

    const position = rank + 1;
    const recentArticles = (site.articles || [])
      .slice(-5)
      .reverse()
      .map((a) => ({ title: a.title, verdict: a.verdict, confidence: a.confidence, scannedAt: a.scannedAt }));

    res.status(200).json({
      success: true,
      data: {
        rank:          position,
        totalSites,
        // percentile: 100 = most fake (rank 1), 0 = most reliable
        percentile:    parseFloat(((1 - (position - 1) / Math.max(totalSites, 1)) * 100).toFixed(1)),
        domain:        site.domain,
        totalScans:    site.totalScans,
        fakeCount:     site.fakeCount,
        realCount:     site.realCount,
        uncertainCount:site.uncertainCount,
        satirCount:    site.satirCount,
        fakeScore:     site.fakeScore,
        trustScore:    parseFloat((100 - site.fakeScore).toFixed(1)),
        riskLevel:     riskLevel(site.fakeScore),
        lastScannedAt: site.lastScannedAt,
        recentArticles,
      },
    });
  } catch (error) {
    next(error);
  }
};
