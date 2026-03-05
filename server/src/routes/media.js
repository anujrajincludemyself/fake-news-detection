const express = require('express');
const router = express.Router();
const { analyzeImage, analyzeVideo } = require('../controllers/mediaController');
const { optionalAuth } = require('../middleware/auth');
const { uploadImage, uploadVideo } = require('../middleware/upload');

router.post('/image', optionalAuth, uploadImage.single('file'), analyzeImage);
router.post('/video', optionalAuth, uploadVideo.single('file'), analyzeVideo);

module.exports = router;
