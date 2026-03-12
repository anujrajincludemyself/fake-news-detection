const Analysis = require('../models/Analysis');
const User = require('../models/User');
const HuggingFaceService = require('../services/huggingFaceService');
const GroqService = require('../services/groqService');
const MistralService = require('../services/mistralService');
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

    const userClaim = req.body.claim || req.body.description || '';
    let prediction;

    // ── Stage 1a: Mistral Pixtral → plain image description (zero Groq quota) ──
    let imageDescription = '';
    if (process.env.MISTRAL_API_KEY) {
      try {
        imageDescription = await MistralService.describeImage(req.file.buffer, req.file.mimetype);
        logger.info(`[Stage-1a Mistral] description: "${imageDescription}"`);
      } catch (mistralErr) {
        logger.warn(`[Stage-1a Mistral] failed — ${mistralErr.message}`);
      }
    }

    // ── Stage 1b: Groq vision fallback if Mistral is unavailable ──────────
    if (!imageDescription && process.env.GROQ_API_KEY) {
      try {
        imageDescription = await GroqService.describeImage(req.file.buffer, req.file.mimetype);
        logger.info(`[Stage-1b Groq vision] description: "${imageDescription}"`);
      } catch (descErr) {
        logger.warn(`[Stage-1b Groq vision] failed — ${descErr.message}`);
      }
    }

    // ── Stage 2: Groq text model judges description vs claim ─────────────────
    let imageMatchResult = null;
    if (imageDescription && process.env.GROQ_API_KEY) {
      try {
        imageMatchResult = await GroqService.analyzeImageClaim(imageDescription, userClaim);
        logger.info(`Image-claim match via BLIP+Groq: ${imageMatchResult.label} (${imageMatchResult.confidence}%)`);
      } catch (groqErr) {
        const reason = groqErr.isRateLimit ? 'rate limit' : groqErr.message;
        logger.warn(`Groq text analysis of image failed (${reason}), trying Groq vision`);
      }
    }

    // ── Stage 3: If image matches the claim, fact-check the claim itself ──────
    // A real image that genuinely matches a claim can still be misinformation
    // if the claim is factually false. We only run this when Stage 2 says REAL.
    // Skip this stage if DISABLE_CLAIM_FACTCHECK env var is set (for faster analysis)
    if (imageMatchResult && imageMatchResult.label === 'REAL' && userClaim && process.env.GROQ_API_KEY && process.env.DISABLE_CLAIM_FACTCHECK !== 'true') {
      try {
        const claimFactResult = await GroqService.factCheckImageClaim(imageDescription, userClaim);
        logger.info(`Claim fact-check: ${claimFactResult.label} (${claimFactResult.confidence}%)`);

        // Merge the two verdicts into one final prediction
        let finalLabel, finalConfidence, finalReasoning;

        if (claimFactResult.label === 'FAKE') {
          // Image matches claim, but the claim itself is false → misinformation
          finalLabel = 'FAKE';
          finalConfidence = claimFactResult.confidence;
          finalReasoning = `Image appears to match the claim, but the claim itself is false: ${claimFactResult.details.reasoning}`;
        } else if (claimFactResult.label === 'UNCERTAIN') {
          finalLabel = 'UNCERTAIN';
          finalConfidence = Math.round((imageMatchResult.confidence + claimFactResult.confidence) / 2);
          finalReasoning = `Image matches the claim but the claim's factual accuracy could not be fully verified.`;
        } else {
          // Both image match AND claim are REAL
          finalLabel = 'REAL';
          finalConfidence = Math.round((imageMatchResult.confidence + claimFactResult.confidence) / 2);
          finalReasoning = `Image genuinely supports the claim, and the claim appears factually accurate.`;
        }

        prediction = {
          label: finalLabel,
          confidence: finalConfidence,
          details: {
            source: 'blip+groq-two-stage',
            model: imageMatchResult.details.model,
            imageDescription,
            imageMatchLabel: imageMatchResult.label,
            imageMatchReasoning: imageMatchResult.details.reasoning,
            claimFactLabel: claimFactResult.label,
            claimFactReasoning: claimFactResult.details.reasoning,
            reasoning: finalReasoning,
          },
        };
      } catch (factErr) {
        const reason = factErr.isRateLimit ? 'rate limit' : factErr.message;
        logger.warn(`Claim fact-check failed (${reason}), using image-match result only`);
        // Fall back to just the image match result
        prediction = imageMatchResult;
      }
    } else if (imageMatchResult) {
      // Stage 2 returned FAKE/UNCERTAIN, or no claim was provided — use as-is
      prediction = imageMatchResult;
    }

    // ── Fallback A: HuggingFace deepfake detector (no claim context) ─────────
    if (!prediction && process.env.HUGGINGFACE_API_TOKEN) {
      try {
        prediction = await HuggingFaceService.analyzeImage(req.file.buffer, req.file.mimetype);
        logger.info(`Image analysis via HuggingFace deepfake detector: ${prediction.label} (${prediction.confidence}%)`);
      } catch (hfErr) {
        const reason = hfErr.isRateLimit ? 'rate limit' : hfErr.message;
        logger.warn(`HuggingFace deepfake detector failed (${reason}), using NLP fallback`);
      }
    }

    // ── Fallback C: Local NLP ─────────────────────────────────────────────────
    if (!prediction) {
      prediction = NLPAnalyzer.analyze(`[Image file: ${req.file.originalname}]`);
      logger.info('Image analysis via local NLP fallback');
    }

    const analysis = await Analysis.create({
      user: req.user ? req.user._id : null,
      title: req.body.title || `Image Analysis: ${req.file.originalname}`,
      content: userClaim ? `[Image file: ${req.file.originalname}] — Claim: ${userClaim}` : `[Image file: ${req.file.originalname}]`,
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
