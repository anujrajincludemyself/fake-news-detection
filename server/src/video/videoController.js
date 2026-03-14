/**
 * videoController.js
 * ───────────────────
 * POST /api/video/analyze
 *
 * Forwards uploaded videos to the ML microservice endpoint /predict/video.
 */

const FormData = require('form-data');
const fetch = require('node-fetch');
const Analysis = require('../models/Analysis');
const User = require('../models/User');
const logger = require('../utils/logger');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

exports.analyzeVideo = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a video file.' });
    }

    const userContext = (req.body.context || req.body.claim || '').trim();
    const title = (req.body.title || `Video Analysis: ${req.file.originalname}`).trim();

    logger.info(`[Video] Received '${req.file.originalname}' (${(req.file.size / 1_048_576).toFixed(1)} MB), context: "${userContext}"`);

    // Forward to ML microservice (/predict/video)
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    let serviceData;
    try {
      const serviceRes = await fetch(`${ML_SERVICE_URL}/predict/video`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
        timeout: 180_000,
      });

      if (!serviceRes.ok) {
        const errBody = await serviceRes.json().catch(() => ({}));
        const msg = errBody?.detail || `Video service returned ${serviceRes.status}`;
        logger.error(`[Video] Service error: ${msg}`);
        return res.status(502).json({
          success: false,
          message: `ML video analysis service error: ${msg}`,
        });
      }

      serviceData = await serviceRes.json();
    } catch (fetchErr) {
      if (fetchErr.code === 'ECONNREFUSED' || fetchErr.type === 'system') {
        logger.error(`[Video] Cannot reach ML service at ${ML_SERVICE_URL}`);
        return res.status(503).json({
          success: false,
          message: 'ML service is not running. Start it with: cd ml-service && python -m uvicorn app:app --port 8000',
        });
      }
      throw fetchErr;
    }

    // Normalize ML labels to the frontend's expected REAL/FAKE/UNCERTAIN scheme.
    const rawLabel = String(serviceData?.label || 'UNCERTAIN').toUpperCase();
    const normalizedLabel =
      rawLabel === 'AUTHENTIC' ? 'REAL' :
      rawLabel === 'MANIPULATED' ? 'FAKE' :
      rawLabel;
    const normalizedConfidence = Number(serviceData?.confidence ?? 50);

    logger.info(`[Video] Service result: ${normalizedLabel} (${normalizedConfidence}%)`);

    // ── Persist to Analysis model ─────────────────────────────────────────────
    const contentStr = userContext
      ? `[Video: ${req.file.originalname}] — Context: ${userContext}`
      : `[Video: ${req.file.originalname}]`;

    const analysis = await Analysis.create({
      user: req.user ? req.user._id : null,
      title: serviceData.title || title,
      content: contentStr,
      analysisType: 'video',
      mediaFilename: req.file.originalname,
      prediction: {
        label: normalizedLabel,
        confidence: normalizedConfidence,
        details: {
          analysisType: 'video',
          videoSummary: '',
          transcript: '',
          language: 'unknown',
          duration: 0,
          frameCount: serviceData?.details?.frames_analyzed || 0,
          userContext,
          reasoning: 'Generated from ML forensic video analysis.',
          models: { videoAnalysis: serviceData?.analysis_type || 'video' },
          serviceErrors: [],
          mlDetails: serviceData?.details || {},
        },
      },
      status: 'completed',
    });

    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, { $inc: { analysisCount: 1 } });
    }

    // ── Return structured response ────────────────────────────────────────────
    res.status(201).json({
      success: true,
      data: {
        _id: analysis._id,
        title: analysis.title,
        analysisType: 'video',
        filename: req.file.originalname,
        userContext,
        transcript: '',
        language: 'unknown',
        duration: 0,
        segments: [],
        videoSummary: 'Forensic consistency analysis completed using ML video model.',
        frameCount: serviceData?.details?.frames_analyzed || 0,
        verdict: {
          label: normalizedLabel,
          confidence: normalizedConfidence,
          reasoning: serviceData?.details?.manipulation_score != null
            ? `Manipulation score: ${serviceData.details.manipulation_score}/100`
            : 'Generated from ML forensic video analysis.',
        },
        errors: [],
        mlDetails: serviceData?.details || {},
        createdAt: analysis.createdAt,
      },
    });
  } catch (error) {
    logger.error(`[Video] Unhandled error: ${error.message}`);
    next(error);
  }
};
