const express = require('express');
const router = express.Router();
const { getWall } = require('../controllers/wallController');

// GET /api/wall — public, no auth needed
router.get('/', getWall);

module.exports = router;
