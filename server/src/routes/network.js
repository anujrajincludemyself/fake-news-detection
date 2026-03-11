const express = require('express');
const router = express.Router();
const { getNetwork } = require('../controllers/networkController');

// GET /api/network — public, no auth needed
router.get('/', getNetwork);

module.exports = router;
