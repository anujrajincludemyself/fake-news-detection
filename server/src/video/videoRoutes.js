/**
 * videoRoutes.js
 * ───────────────
 * Mounts all video-analysis endpoints under /api/video
 */

const express = require('express');
const router = express.Router();
const { analyzeVideo } = require('./videoController');
const { optionalAuth } = require('../middleware/auth');
const { uploadVideo } = require('../middleware/upload');

// POST /api/video/analyze
// Body: multipart/form-data
//   file    – video file (required)
//   title   – optional title string
//   context – what the user says the video is about / the claim being made
router.post('/analyze', optionalAuth, uploadVideo.single('file'), analyzeVideo);

module.exports = router;
