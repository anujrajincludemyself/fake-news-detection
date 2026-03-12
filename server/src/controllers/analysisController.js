const Analysis = require('../models/Analysis');
const User = require('../models/User');
const PredictionService = require('../services/predictionService');
const { recordScan } = require('../services/siteRecorder');
const logger = require('../utils/logger');

// @desc    Analyze news text
// @route   POST /api/analysis
exports.analyzeNews = async (req, res, next) => {
  try {
    const { title, content, sourceUrl } = req.body;

    if (!content || content.trim().length < 20) {
      return res.status(400).json({
        success: false,
        message: 'Please provide news content (at least 20 characters)',
      });
    }

    // Get prediction
    const prediction = await PredictionService.predict(content);

    // Save analysis
    const analysis = await Analysis.create({
      user: req.user ? req.user._id : null,
      title: title || content.substring(0, 100),
      content,
      sourceUrl,
      prediction,
      status: 'completed',
    });

    // Update user analysis count
    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { analysisCount: 1 },
      });
    }

    // Record to Wall of Fake when a sourceUrl/domain is provided
    if (sourceUrl) {
      try {
        const hostname = new URL(sourceUrl).hostname.replace(/^www\./, '');
        recordScan({
          domain: hostname,
          url: sourceUrl,
          title: title || '',
          verdict: prediction.label,
          confidence: prediction.confidence,
        });
      } catch (_) { /* invalid URL — skip */ }
    }

    logger.info(
      `Analysis completed: ${prediction.label} (${prediction.confidence}%)`
    );

    res.status(201).json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user's analysis history (own web analyses + extension scans)
// @route   GET /api/analysis/history
exports.getHistory = async (req, res, next) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip  = (page - 1) * limit;

    // Show user's own analyses AND extension scans (user: null)
    const filter = { $or: [{ user: req.user._id }, { user: null }] };

    if (req.query.label) {
      filter['prediction.label'] = req.query.label.toUpperCase();
    }

    const [analyses, total] = await Promise.all([
      Analysis.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-content'),
      Analysis.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: analyses,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single analysis
// @route   GET /api/analysis/:id
exports.getAnalysis = async (req, res, next) => {
  try {
    const analysis = await Analysis.findById(req.params.id);

    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: 'Analysis not found',
      });
    }

    // Ownership check — only the owner (or admin) may see the full content
    if (
      analysis.user &&
      analysis.user.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    res.status(200).json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Submit feedback on analysis
// @route   PUT /api/analysis/:id/feedback
exports.submitFeedback = async (req, res, next) => {
  try {
    const { isCorrect, userLabel } = req.body;

    const analysis = await Analysis.findByIdAndUpdate(
      req.params.id,
      {
        feedback: { isCorrect, userLabel },
      },
      { new: true }
    );

    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: 'Analysis not found',
      });
    }

    logger.info(`Feedback received for analysis ${req.params.id}`);

    res.status(200).json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get dashboard stats (own web analyses + all extension scans)
// @route   GET /api/analysis/stats
exports.getStats = async (req, res, next) => {
  try {
    const userId = req.user._id;
    // Include user's own analyses AND extension scans (user: null)
    const statsFilter = { $or: [{ user: userId }, { user: null }] };

    const [totalAnalyses, labelStats, recentAnalyses] = await Promise.all([
      Analysis.countDocuments(statsFilter),
      Analysis.aggregate([
        { $match: statsFilter },
        {
          $group: {
            _id: '$prediction.label',
            count: { $sum: 1 },
            avgConfidence: { $avg: '$prediction.confidence' },
          },
        },
      ]),
      Analysis.find(statsFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .select('title prediction.label prediction.confidence createdAt sourceUrl user'),
    ]);

    const stats = {
      totalAnalyses,
      labels: {
        REAL:      { count: 0, avgConfidence: 0 },
        FAKE:      { count: 0, avgConfidence: 0 },
        UNCERTAIN: { count: 0, avgConfidence: 0 },
      },
      recentAnalyses,
    };

    labelStats.forEach((stat) => {
      if (stats.labels[stat._id] !== undefined) {
        stats.labels[stat._id] = {
          count: stat.count,
          avgConfidence: Math.round(stat.avgConfidence * 100) / 100,
        };
      }
    });

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};
