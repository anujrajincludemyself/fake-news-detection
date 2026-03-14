const fetch = require('node-fetch');
const logger = require('../utils/logger');

const HF_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
const HF_BASE = 'https://router.huggingface.co/hf-inference/models';

// Primary text fake-news classifier (RoBERTa fine-tuned on LIAR dataset)
// Labels: LABEL_0 = FAKE, LABEL_1 = REAL
const TEXT_MODEL = 'hamzab/roberta-fake-news-classification';

// Fallback text model (DistilBERT)
// Labels: FAKE / REAL
const TEXT_MODEL_FALLBACK = 'GonzaloA/fake_news_model';

const RETRY_DELAYS = [2000, 5000, 10000];

class HuggingFaceService {
  // ─── Helpers ─────────────────────────────────────────────────────────────────

  static _headers() {
    if (!HF_TOKEN) throw new Error('HUGGINGFACE_API_TOKEN is not configured');
    return { Authorization: `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' };
  }

  static async _withRetry(fn) {
    let lastError;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        // Stop immediately on rate-limit — retrying burns more quota
        if (err.isRateLimit) throw err;
        // Only retry when a model is still loading (503)
        const isTransient = err.isLoading || err.message?.includes('loading');
        if (!isTransient || attempt === RETRY_DELAYS.length) break;
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      }
    }
    throw lastError;
  }

  static async _postJSON(modelId, body) {
    const res = await fetch(`${HF_BASE}/${modelId}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    if (res.status === 503) {
      const err = new Error(`Model ${modelId} is loading, please retry`);
      err.isLoading = true;
      throw err;
    }
    if (res.status === 429) {
      const err = new Error('HuggingFace rate limit hit');
      err.isRateLimit = true;
      throw err;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `HuggingFace API returned ${res.status}`);
    }
    return res.json();
  }

  /**
   * Map raw HuggingFace classification output to { label, confidence, details }
   * Handles multiple label naming conventions across models.
   */
  static _mapTextResult(results) {
    // results is an array of [{ label, score }, ...]
    // Sometimes it's nested: [[{ label, score }]]
    const flat = Array.isArray(results[0]) ? results[0] : results;

    // Sort descending by score
    const sorted = [...flat].sort((a, b) => b.score - a.score);
    const top = sorted[0];

    // Normalise label to REAL / FAKE / UNCERTAIN
    const rawLabel = (top.label || '').toLowerCase();
    let label;
    if (
      rawLabel === 'real' || rawLabel === 'label_1' ||
      rawLabel === 'true' || rawLabel === 'reliable'
    ) {
      label = 'REAL';
    } else if (
      rawLabel === 'fake' || rawLabel === 'label_0' ||
      rawLabel === 'false' || rawLabel === 'unreliable'
    ) {
      label = 'FAKE';
    } else {
      label = 'UNCERTAIN';
    }

    const confidence = Math.round(top.score * 10000) / 100; // 0-100

    return {
      label,
      confidence,
      details: {
        source: 'huggingface',
        modelScores: sorted.map((r) => ({
          label: r.label,
          score: Math.round(r.score * 10000) / 100,
        })),
      },
    };
  }


  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Classify a news text as REAL / FAKE / UNCERTAIN.
   */
  static async analyzeText(text) {
    // Truncate to 512 tokens worth of chars (safe for BERT-based models)
    const input = text.slice(0, 1800);

    return this._withRetry(async () => {
      let raw;
      try {
        raw = await this._postJSON(TEXT_MODEL, { inputs: input });
      } catch (primaryErr) {
        // Try fallback model before giving up
        logger.warn(`Primary HF model failed (${primaryErr.message}), trying fallback`);
        raw = await this._postJSON(TEXT_MODEL_FALLBACK, { inputs: input });
      }
      return this._mapTextResult(raw);
    });
  }
}

module.exports = HuggingFaceService;
