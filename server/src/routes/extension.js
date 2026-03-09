const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { analyzeArticle } = require('../controllers/extensionController');

const router = express.Router();

// CORS is set to open (*) for this route in index.js because content scripts
// carry the news site's origin (e.g. ndtv.com), not chrome-extension://.
// Security is handled by the X-Extension-Key header check in the controller.

// Extension-specific rate limit: 30 requests per minute
const extensionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.headers['x-extension-key'] || req.ip,
  message: { success: false, message: 'Extension rate limit reached, please slow down' },
});

router.options('/analyze', cors({ origin: '*' }));
router.post('/analyze', extensionLimiter, analyzeArticle);

module.exports = router;
