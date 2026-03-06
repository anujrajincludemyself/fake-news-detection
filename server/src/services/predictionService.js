const logger = require('../utils/logger');
const NLPAnalyzer = require('./nlpAnalyzer');
const HuggingFaceService = require('./huggingFaceService');

class PredictionService {
  /**
   * Verify text using HuggingFace first; fall back to local NLP if the API
   * is unavailable or not configured.
   */
  static async predict(text) {
    if (process.env.HUGGINGFACE_API_TOKEN) {
      try {
        return await HuggingFaceService.analyzeText(text);
      } catch (error) {
        logger.warn('HuggingFace unavailable for text analysis, falling back to NLP:', error.message);
      }
    }

    // Fallback to built-in NLP analysis
    return NLPAnalyzer.analyze(text);
  }
}

module.exports = PredictionService;
