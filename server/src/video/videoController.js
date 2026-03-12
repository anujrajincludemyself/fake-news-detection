/**
 * videoController.js
 * ───────────────────
 * POST /api/video/analyze
 *
 * Forwards the uploaded video to the local Python video-processing service
 * (http://localhost:8001/process) which handles:
 *   - Frame extraction (ffmpeg, local)
 *   - Audio transcription (faster-whisper, local GPU/CPU)
 *   - Groq vision call  (description — transcript + 2 frames)
 *   - Groq text call    (fact-check verdict)
 *
 * Total Groq calls per video: 2 (instead of 7+ in the naive approach)
 */

const FormData = require('form-data');
const fetch = require('node-fetch');
const Analysis = require('../models/Analysis');
const User = require('../models/User');
const logger = require('../utils/logger');

const VIDEO_SERVICE_URL = process.env.VIDEO_SERVICE_URL || 'http://localhost:8001';

exports.analyzeVideo = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a video file.' });
    }

    const userContext = (req.body.context || req.body.claim || '').trim();
    const title = (req.body.title || `Video Analysis: ${req.file.originalname}`).trim();

    logger.info(`[Video] Received '${req.file.originalname}' (${(req.file.size / 1_048_576).toFixed(1)} MB), context: "${userContext}"`);

    // ── Forward to video-processing Python service ───────────────────────────
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    form.append('context', userContext);
    form.append('title', title);

    let serviceData;
    try {
      const serviceRes = await fetch(`${VIDEO_SERVICE_URL}/process`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
        timeout: 180_000, // 3 min — whisper transcription can take a while
      });

      if (!serviceRes.ok) {
        const errBody = await serviceRes.json().catch(() => ({}));
        const msg = errBody?.detail || `Video service returned ${serviceRes.status}`;
        logger.error(`[Video] Service error: ${msg}`);
        return res.status(502).json({
          success: false,
          message: `Video processing service error: ${msg}`,
        });
      }

      serviceData = await serviceRes.json();
    } catch (fetchErr) {
      if (fetchErr.code === 'ECONNREFUSED' || fetchErr.type === 'system') {
        logger.error(`[Video] Cannot reach video-processing service at ${VIDEO_SERVICE_URL}`);
        return res.status(503).json({
          success: false,
          message: 'Video processing service is not running. Start it with: cd video-processing && python app.py',
        });
      }
      throw fetchErr;
    }

    logger.info(`[Video] Service result: ${serviceData.verdict?.label} (${serviceData.verdict?.confidence}%)`);

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
        label: serviceData.verdict?.label || 'UNCERTAIN',
        confidence: serviceData.verdict?.confidence ?? 50,
        details: {
          analysisType: 'video',
          videoSummary: serviceData.videoSummary || '',
          transcript: serviceData.transcript || '',
          language: serviceData.language || 'unknown',
          duration: serviceData.duration || 0,
          frameCount: serviceData.frameCount || 0,
          userContext,
          reasoning: serviceData.verdict?.reasoning || '',
          models: serviceData.verdict?.models || {},
          serviceErrors: serviceData.errors || [],
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
        transcript: serviceData.transcript || '',
        language: serviceData.language || 'unknown',
        duration: serviceData.duration || 0,
        segments: serviceData.segments || [],
        videoSummary: serviceData.videoSummary || '',
        frameCount: serviceData.frameCount || 0,
        verdict: {
          label: serviceData.verdict?.label || 'UNCERTAIN',
          confidence: serviceData.verdict?.confidence ?? 50,
          reasoning: serviceData.verdict?.reasoning || '',
        },
        errors: serviceData.errors || [],
        createdAt: analysis.createdAt,
      },
    });
  } catch (error) {
    logger.error(`[Video] Unhandled error: ${error.message}`);
    next(error);
  }
};
