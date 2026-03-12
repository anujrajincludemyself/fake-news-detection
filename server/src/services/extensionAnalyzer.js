const fetch = require('node-fetch');
const logger = require('../utils/logger');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

// In-memory URL cache (avoids re-analyzing same article)
const urlCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE = 500;

function getCached(key) {
  const entry = urlCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    urlCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  if (urlCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry
    urlCache.delete(urlCache.keys().next().value);
  }
  urlCache.set(key, { data, timestamp: Date.now() });
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'ref', 'fbclid', 'gclid', 'cid', '_ga'].forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

class ExtensionAnalyzer {
  static getCacheKey(url) {
    return normalizeUrl(url || '');
  }

  /**
   * Comprehensive single-call analysis via Groq.
   * Returns verdict, credibility, bias, emotional score, clickbait score,
   * suspicious sentences, red flags, and positive signals — all in ONE API call.
   */
  static async analyze({ url, title, content, domain }) {
    const cacheKey = this.getCacheKey(url || '');

    // Return cached result if fresh
    if (cacheKey) {
      const cached = getCached(cacheKey);
      if (cached) return { ...cached, cached: true };
    }

    const text = [title, content].filter(Boolean).join('\n\n').trim();

    if (!GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is not configured on the server.');
    }

    const result = await this._groqAnalyze(text, title, domain);

    if (cacheKey) setCache(cacheKey, result);
    return { ...result, cached: false };
  }

  static async _groqAnalyze(text, title, domain) {
    const prompt = `You are an expert fact-checker and media bias analyst. Analyze the following news article comprehensively.

Respond ONLY with raw JSON — no markdown, no explanation outside the JSON. Required schema:
{
  "verdict": "REAL" | "FAKE" | "UNCERTAIN" | "SATIRE",
  "confidence": <integer 0-100>,
  "credibilityScore": <integer 0-100>,
  "reasoning": "<1-2 sentence summary of your assessment>",
  "bias": "LEFT" | "RIGHT" | "CENTER" | "UNKNOWN",
  "biasStrength": <integer 0-100>,
  "emotionalLanguageScore": <integer 0-100>,
  "clickbaitScore": <integer 0-100>,
  "suspiciousSentences": ["<verbatim sentence from article>", ...],
  "redFlags": ["<concrete issue found>", ...],
  "positiveSignals": ["<credibility indicator>", ...]
}

Scoring guidelines:
- credibilityScore: 0 = completely fake/fabricated, 100 = highly credible / well-sourced
- emotionalLanguageScore: 0 = neutral/dry prose, 100 = extreme fear/anger/outrage language
- clickbaitScore: 0 = straightforward headline, 100 = pure clickbait / sensationalist title
- suspiciousSentences: up to 3 verbatim sentences from the text that contain unverified claims, logical fallacies, or misleading framing
- redFlags: up to 5 concrete problems (e.g. "Uses anonymous sources", "Contradicts known facts", "Emotional manipulation")
- positiveSignals: up to 3 credibility indicators (e.g. "Cites peer-reviewed study", "Named expert sources")`;

    const userContent = `Analyze this ${domain ? `article from ${domain}` : 'news article'}:

Title: ${title || '(untitled)'}

${text.slice(0, 4000)}`;

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 600,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: userContent },
        ],
      }),
    });

    if (response.status === 429) {
      const err = new Error('Groq rate limit');
      err.isRateLimit = true;
      throw err;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = body?.error?.message || body?.message || JSON.stringify(body);
      logger.error(`Groq API ${response.status}: ${msg}`);
      throw new Error(`Groq API ${response.status}: ${msg}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (error) {
      // Try to extract JSON object more carefully
      let match = null;
      let braceCount = 0;
      let startIdx = -1;
      
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === '{') {
          if (braceCount === 0) startIdx = i;
          braceCount++;
        } else if (cleaned[i] === '}') {
          braceCount--;
          if (braceCount === 0 && startIdx !== -1) {
            match = cleaned.substring(startIdx, i + 1);
            break;
          }
        }
      }
      
      if (!match) {
        logger.error('Could not extract JSON from Groq response', { raw: raw.substring(0, 200) });
        throw new Error('Could not parse Groq response as JSON');
      }
      
      try {
        parsed = JSON.parse(match);
      } catch (parseError) {
        logger.error('Invalid JSON extracted from Groq', { match: match.substring(0, 200) });
        throw parseError;
      }
    }

    const validVerdicts = ['REAL', 'FAKE', 'UNCERTAIN', 'SATIRE'];
    const validBias = ['LEFT', 'RIGHT', 'CENTER', 'UNKNOWN'];

    return {
      verdict: validVerdicts.includes(String(parsed.verdict).toUpperCase())
        ? String(parsed.verdict).toUpperCase()
        : 'UNCERTAIN',
      confidence: clamp(parsed.confidence, 0, 100),
      credibilityScore: clamp(parsed.credibilityScore, 0, 100),
      reasoning: String(parsed.reasoning || '').slice(0, 300),
      bias: validBias.includes(String(parsed.bias).toUpperCase())
        ? String(parsed.bias).toUpperCase()
        : 'UNKNOWN',
      biasStrength: clamp(parsed.biasStrength, 0, 100),
      emotionalLanguageScore: clamp(parsed.emotionalLanguageScore, 0, 100),
      clickbaitScore: clamp(parsed.clickbaitScore, 0, 100),
      suspiciousSentences: toStringArray(parsed.suspiciousSentences, 3),
      redFlags: toStringArray(parsed.redFlags, 5),
      positiveSignals: toStringArray(parsed.positiveSignals, 3),
      source: 'groq',
      model: MODEL,
    };
  }

}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, Math.round(Number(val) || 0)));
}

function toStringArray(arr, limit) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, limit)
    .map(s => String(s).trim())
    .filter(s => s.length > 0);
}

module.exports = ExtensionAnalyzer;
