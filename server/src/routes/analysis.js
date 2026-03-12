const express = require('express');
const router = express.Router();
const {
  analyzeNews,
  getHistory,
  getAnalysis,
  submitFeedback,
  getStats,
} = require('../controllers/analysisController');
const { protect, optionalAuth } = require('../middleware/auth');

router.post('/', protect, analyzeNews);
router.get('/history', protect, getHistory);
router.get('/stats', protect, getStats);
router.get('/:id', getAnalysis);
router.put('/:id/feedback', submitFeedback);

module.exports = router;
