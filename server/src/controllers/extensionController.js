const ExtensionAnalyzer = require('../services/extensionAnalyzer');
const Analysis = require('../models/Analysis');
const { recordScan } = require('../services/siteRecorder');
const logger = require('../utils/logger');

const EXTENSION_API_KEY = process.env.EXTENSION_API_KEY || 'tl-extension-dev-key';

// @desc    Analyze article text from the TruthLens browser extension
// @route   POST /api/extension/analyze
// @access  Extension-only (API key header required)
exports.analyzeArticle = async (req, res, next) => {
  try {
    // Validate extension API key
    const providedKey = req.headers['x-extension-key'];
    if (!providedKey || providedKey !== EXTENSION_API_KEY) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { url, title, content, domain } = req.body;

    if (!content || content.trim().length < 100) {
      return res.status(400).json({
        success: false,
        message: 'Article content too short (minimum 100 characters)',
      });
    }

    // analyze() owns the cache — one call, no duplicate checks
    const result = await ExtensionAnalyzer.analyze({ url, title, content, domain });

    if (result.cached) {
      logger.info(`Extension cache hit: ${domain || url}`);
    } else {
      logger.info(
        `Extension analysis done: ${result.verdict} (${result.confidence}%) via ${result.source}`
      );
    }

    // Record to Wall of Fake (fire-and-forget, non-blocking)
    if (!result.cached && domain) {
      recordScan({
        domain,
        url,
        title,
        verdict: result.verdict,
        confidence: result.confidence,
      });

      // Also persist to Analysis collection so it shows in History
      Analysis.create({
        user: null,
        title: title || url || 'Extension Scan',
        content: content,
        sourceUrl: url || '',
        prediction: {
          label: result.verdict,
          confidence: result.confidence,
          details: { analysisType: 'text' },
        },
        status: 'completed',
      }).catch(() => {}); // fire-and-forget, never block the response
    }

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
