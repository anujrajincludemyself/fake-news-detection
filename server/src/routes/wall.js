const express = require('express');
const router = express.Router();
const { getWall, getTrendingRumor } = require('../controllers/wallController');

// GET /api/wall — public, no auth needed
router.get('/', getWall);
router.get('/trending-rumor', getTrendingRumor);

module.exports = router;
