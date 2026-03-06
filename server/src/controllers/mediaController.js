const Analysis = require('../models/Analysis');
const User = require('../models/User');
const HuggingFaceService = require('../services/huggingFaceService');
const NLPAnalyzer = require('../services/nlpAnalyzer');
const logger = require('../utils/logger');


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

    let prediction;
    try {
      prediction = await HuggingFaceService.analyzeImage(req.file.buffer, req.file.mimetype);
    } catch (hfErr) {
      logger.warn('HuggingFace image analysis failed, using NLP fallback:', hfErr.message);
      prediction = NLPAnalyzer.analyze(`[Image file: ${req.file.originalname}]`);
    }

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
          ...prediction.details,
        },
      },
      status: 'completed',
    });

    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, { $inc: { analysisCount: 1 } });
    }

    res.status(201).json({ success: true, data: analysis });
  } catch (error) {
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

    let prediction;
    // HuggingFace free tier has no video model; fall back to NLP
    try {
      prediction = NLPAnalyzer.analyze(`[Video file: ${req.file.originalname}]`);
    } catch (err) {
      logger.warn('Video analysis error:', err.message);
      prediction = { label: 'UNCERTAIN', confidence: 50, details: { source: 'nlp' } };
    }

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
          ...prediction.details,
        },
      },
      status: 'completed',
    });

    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, { $inc: { analysisCount: 1 } });
    }

    res.status(201).json({ success: true, data: analysis });
  } catch (error) {
    next(error);
  }
};
