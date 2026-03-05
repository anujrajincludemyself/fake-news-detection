const fetch = require('node-fetch');
const FormData = require('form-data');
const Analysis = require('../models/Analysis');
const User = require('../models/User');
const logger = require('../utils/logger');

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

/**
 * Forward a file buffer to ML service and return the result.
 */
async function callMLMedia(endpoint, fileBuffer, filename, mimetype) {
  const form = new FormData();
  form.append('file', fileBuffer, { filename, contentType: mimetype });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s for video

  try {
    const response = await fetch(`${ML_URL}${endpoint}`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `ML service returned ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// @desc    Analyze an image for manipulation
// @route   POST /api/media/image
exports.analyzeImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload an image file',
      });
    }

    const prediction = await callMLMedia(
      '/predict/image',
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    // Save analysis
    const analysis = await Analysis.create({
      user: req.user ? req.user._id : null,
      title: req.body.title || `Image Analysis: ${req.file.originalname}`,
      content: `[Image file: ${req.file.originalname}]`,
      analysisType: 'image',
      mediaFilename: req.file.originalname,
      prediction: {
        label: prediction.label,
        confidence: prediction.confidence,
        details: {
          analysisType: 'image',
          mediaDetails: prediction.details,
        },
      },
      status: 'completed',
    });

    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { analysisCount: 1 },
      });
    }

    logger.info(
      `Image analysis completed: ${prediction.label} (${prediction.confidence}%)`
    );

    res.status(201).json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    logger.error('Image analysis error:', error.message);
    if (error.message.includes('ML service') || error.name === 'AbortError') {
      return res.status(503).json({
        success: false,
        message: 'ML analysis service is unavailable. Please try again later.',
      });
    }
    next(error);
  }
};

// @desc    Analyze a video for manipulation
// @route   POST /api/media/video
exports.analyzeVideo = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a video file',
      });
    }

    const prediction = await callMLMedia(
      '/predict/video',
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    const analysis = await Analysis.create({
      user: req.user ? req.user._id : null,
      title: req.body.title || `Video Analysis: ${req.file.originalname}`,
      content: `[Video file: ${req.file.originalname}]`,
      analysisType: 'video',
      mediaFilename: req.file.originalname,
      prediction: {
        label: prediction.label,
        confidence: prediction.confidence,
        details: {
          analysisType: 'video',
          mediaDetails: prediction.details,
        },
      },
      status: 'completed',
    });

    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { analysisCount: 1 },
      });
    }

    logger.info(
      `Video analysis completed: ${prediction.label} (${prediction.confidence}%)`
    );

    res.status(201).json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    logger.error('Video analysis error:', error.message);
    if (error.message.includes('ML service') || error.name === 'AbortError') {
      return res.status(503).json({
        success: false,
        message: 'ML analysis service is unavailable. Please try again later.',
      });
    }
    next(error);
  }
};
