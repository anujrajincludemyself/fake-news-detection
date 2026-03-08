const logger = require('../utils/logger');
const NLPAnalyzer = require('./nlpAnalyzer');
const HuggingFaceService = require('./huggingFaceService');
const GeminiService = require('./geminiService');
const GroqService = require('./groqService');

class PredictionService {
  /**
   * Text analysis fallback chain:
   *   1. Groq      — llama-3.3-70b, 14,400 req/day, 30 RPM, best free option
   *   2. Gemini    — gemini-2.0-flash, 1,500 req/day, backup LLM
   *   3. HuggingFace — RoBERTa classifier, style-based, no world knowledge
   *   4. Local NLP — zero API calls, always works, style-based only
   */
  static async predict(text) {
    // Tier 1: Groq (primary LLM)
    if (process.env.GROQ_API_KEY) {
      try {
        const result = await GroqService.analyzeText(text);
        logger.info(`Text analysis via Groq: ${result.label} (${result.confidence}%)`);
        return result;
      } catch (err) {
        const reason = err.isRateLimit ? 'rate limit' : err.message;
        logger.warn(`Groq failed (${reason}), trying Gemini`);
      }
    }

    // Tier 2: Gemini (backup LLM)
    if (process.env.GEMINI_API_KEY) {
      try {
        const result = await GeminiService.analyzeText(text);
        logger.info(`Text analysis via Gemini: ${result.label} (${result.confidence}%)`);
        return result;
      } catch (err) {
        const reason = err.isRateLimit ? 'rate limit' : err.message;
        logger.warn(`Gemini failed (${reason}), trying HuggingFace`);
      }
    }

    // Tier 3: HuggingFace (style-based classifier, no world knowledge)
    if (process.env.HUGGINGFACE_API_TOKEN) {
      try {
        const result = await HuggingFaceService.analyzeText(text);
        logger.info(`Text analysis via HuggingFace: ${result.label} (${result.confidence}%)`);
        return result;
      } catch (err) {
        const reason = err.isRateLimit ? 'rate limit' : err.message;
        logger.warn(`HuggingFace failed (${reason}), falling back to local NLP`);
      }
    }

    // Tier 4: Local NLP — always works, style-based only, cannot detect satire
    logger.info('Text analysis via local NLP (style-based only, no world knowledge)');
    const nlpResult = NLPAnalyzer.analyze(text);
    return {
      ...nlpResult,
      confidence: Math.min(nlpResult.confidence, 70),
      details: {
        ...nlpResult.details,
        warning: 'Local NLP only — satire and implausible content may not be detected.',
      },
    };
  }
}

module.exports = PredictionService;
