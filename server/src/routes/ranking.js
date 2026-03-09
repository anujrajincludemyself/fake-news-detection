const express = require('express');
const router  = express.Router();
const {
  getRankings,
  getRankingStats,
  getTopFake,
  getMostReliable,
  getSiteRank,
} = require('../controllers/rankingController');

// GET /api/ranking              — paginated, sortable leaderboard
router.get('/', getRankings);

// GET /api/ranking/stats        — aggregated statistics & risk breakdown
router.get('/stats', getRankingStats);

// GET /api/ranking/top-fake     — top N most fake sites
router.get('/top-fake', getTopFake);

// GET /api/ranking/most-reliable — top N most reliable sites
router.get('/most-reliable', getMostReliable);

// GET /api/ranking/site/:domain — rank & details for a specific domain
router.get('/site/:domain', getSiteRank);

module.exports = router;
