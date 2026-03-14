/**
 * videoController.js
 * ───────────────────
 * POST /api/video/analyze
 *
 * Forwards uploaded videos to the ML microservice endpoint /predict/video/pipeline.
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

    // Forward to ML microservice (/predict/video/pipeline)
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    if (userContext) {
      form.append('context', userContext);
    }

    let serviceData;
    try {
      const serviceRes = await fetch(`${ML_SERVICE_URL}/predict/video/pipeline`, {
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

    // Convert multimodal risk output into frontend's REAL/FAKE/UNCERTAIN scheme.
    const authenticity = Number(serviceData?.videoAuthenticityScore ?? 50);
    const rawLabel =
      authenticity >= 60 ? 'REAL'
      : authenticity <= 40 ? 'FAKE'
      : 'UNCERTAIN';
    const normalizedLabel =
      rawLabel === 'AUTHENTIC' ? 'REAL' :
      rawLabel === 'MANIPULATED' ? 'FAKE' :
      rawLabel;
    const normalizedConfidence = Number.isFinite(authenticity)
      ? Math.max(0, Math.min(100, Math.round(authenticity)))
      : 50;

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
          videoSummary: serviceData?.summary
            ? `Visual risk: ${serviceData.summary['Visual Deepfake Risk']}, Voice risk: ${serviceData.summary['Voice Deepfake Risk']}, Fact-check risk: ${serviceData.summary['Fact-check Risk']}`
            : 'Multimodal video analysis completed.',
          transcript: serviceData?.transcript || '',
          language: serviceData?.language || 'unknown',
          duration: 0,
          frameCount: serviceData?.debug?.framesExtracted || 0,
          userContext,
          reasoning: `Authenticity ${normalizedConfidence}%. Visual ${serviceData?.visualDeepfakeRisk ?? 'N/A'}%, Voice ${serviceData?.voiceDeepfakeRisk ?? 'N/A'}%, Fact-check ${serviceData?.factCheckRisk ?? 'N/A'}%.`,
          models: { videoAnalysis: 'multimodal_pipeline' },
          serviceErrors: [],
          mlDetails: serviceData || {},
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
        transcript: serviceData?.transcript || '',
        language: serviceData?.language || 'unknown',
        duration: 0,
        segments: serviceData?.segments || [],
        videoSummary: serviceData?.summary
          ? `Visual Deepfake Risk: ${serviceData.summary['Visual Deepfake Risk']} | Voice Deepfake Risk: ${serviceData.summary['Voice Deepfake Risk']} | Fact-check Risk: ${serviceData.summary['Fact-check Risk']}`
          : 'Multimodal video analysis completed.',
        frameCount: serviceData?.debug?.framesExtracted || 0,
        verdict: {
          label: normalizedLabel,
          confidence: normalizedConfidence,
          reasoning: `Final authenticity ${normalizedConfidence}% (visual ${serviceData?.visualDeepfakeRisk ?? 'N/A'}%, voice ${serviceData?.voiceDeepfakeRisk ?? 'N/A'}%, fact-check ${serviceData?.factCheckRisk ?? 'N/A'}%).`,
          models: {
            pipeline: 'video/pipeline',
            visualRisk: serviceData?.visualDeepfakeRisk,
            voiceRisk: serviceData?.voiceDeepfakeRisk,
            factCheckRisk: serviceData?.factCheckRisk,
          },
        },
        errors: [],
        mlDetails: serviceData || {},
        createdAt: analysis.createdAt,
      },
    });
  } catch (error) {
    logger.error(`[Video] Unhandled error: ${error.message}`);
    next(error);
  }
};
