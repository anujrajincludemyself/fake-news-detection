const fetch = require('node-fetch');
const logger = require('../utils/logger');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.0-flash';

const RETRY_DELAYS = [1000, 3000, 7000]; // exponential-ish back-off in ms

class GeminiService {
  // ─── Internal helpers ────────────────────────────────────────────────────────

  static async _post(endpoint, body) {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const url = `${GEMINI_BASE_URL}${endpoint}?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      const err = new Error('Gemini rate limit exceeded');
      err.isRateLimit = true;
      throw err;
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(
        errBody?.error?.message || `Gemini API returned ${response.status}`
      );
    }

    return response.json();
  }

  /** Retry wrapper – retries on rate-limit / transient errors */
  static async _withRetry(fn) {
    let lastError;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const isTransient = err.isRateLimit || err.message?.includes('503') || err.message?.includes('502');
        if (!isTransient || attempt === RETRY_DELAYS.length) break;
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      }
    }
    throw lastError;
  }

  /** Parse Gemini text response into a structured prediction object */
  static _parseResponse(rawText) {
    // Strip optional markdown code fences
    const cleaned = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/gi, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Gemini didn't return pure JSON – try to extract it
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse Gemini response as JSON');
      parsed = JSON.parse(match[0]);
    }

    const label = String(parsed.label || '').toUpperCase();
    const validLabel = ['REAL', 'FAKE', 'UNCERTAIN'].includes(label) ? label : 'UNCERTAIN';
    const confidence = Math.min(100, Math.max(0, Number(parsed.confidence) || 50));

    return {
      label: validLabel,
      confidence: Math.round(confidence * 100) / 100,
      details: {
        source: 'gemini',
        reasoning: parsed.reasoning || parsed.explanation || '',
      },
    };
  }

  static _extractCandidateText(data) {
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Verify a text article.
   * Returns { label, confidence, details }
   */
  static async analyzeText(text) {
    const prompt = `You are a professional fact-checking AI. Analyze the following news content and determine whether it is real or fake news.

Consider: factual accuracy, source credibility signals, sensationalist language, logical consistency, and verifiable claims.

Respond ONLY with a raw JSON object — no markdown, no extra text:
{
  "label": "REAL" | "FAKE" | "UNCERTAIN",
  "confidence": <integer 0-100>,
  "reasoning": "<one or two sentence explanation>"
}

News content to analyze:
${text}`;

    return this._withRetry(async () => {
      const data = await this._post(`/models/${GEMINI_MODEL}:generateContent`, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
      });
      const raw = this._extractCandidateText(data);
      return this._parseResponse(raw);
    });
  }

  /**
   * Verify an image for manipulation / misinformation.
   * @param {Buffer} imageBuffer
   * @param {string} mimeType  e.g. 'image/jpeg'
   */
  static async analyzeImage(imageBuffer, mimeType) {
    const base64Data = imageBuffer.toString('base64');

    const prompt = `You are a media forensics AI. Examine this image and determine:
- Is it digitally manipulated, AI-generated, or taken out of context to spread misinformation?
- Or does it appear to be an authentic, unaltered photograph?

Respond ONLY with a raw JSON object — no markdown, no extra text:
{
  "label": "REAL" | "FAKE" | "UNCERTAIN",
  "confidence": <integer 0-100>,
  "reasoning": "<one or two sentence explanation>"
}`;

    return this._withRetry(async () => {
      const data = await this._post(`/models/${GEMINI_MODEL}:generateContent`, {
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64Data } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
      });
      const raw = this._extractCandidateText(data);
      return this._parseResponse(raw);
    });
  }

  /**
   * Verify a video by uploading it via the Gemini Files API then analysing it.
   * Falls back gracefully if the file is too large or upload fails.
   * @param {Buffer} videoBuffer
   * @param {string} mimeType  e.g. 'video/mp4'
   * @param {string} filename
   */
  static async analyzeVideo(videoBuffer, mimeType, filename) {
    // Upload file using the resumable Files API
    const uploadUrl = await this._uploadFile(videoBuffer, mimeType, filename);

    const prompt = `You are a media forensics AI. Watch this video and determine:
- Does it show signs of deepfake manipulation, AI generation, or is it used out of context to spread misinformation?
- Or does it appear to be authentic, unaltered footage?

Respond ONLY with a raw JSON object — no markdown, no extra text:
{
  "label": "REAL" | "FAKE" | "UNCERTAIN",
  "confidence": <integer 0-100>,
  "reasoning": "<one or two sentence explanation>"
}`;

    return this._withRetry(async () => {
      const data = await this._post(`/models/${GEMINI_MODEL}:generateContent`, {
        contents: [
          {
            parts: [
              { text: prompt },
              { fileData: { mimeType, fileUri: uploadUrl } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
      });
      const raw = this._extractCandidateText(data);
      return this._parseResponse(raw);
    });
  }

  /**
   * Upload a file to Gemini Files API and return the file URI.
   */
  static async _uploadFile(buffer, mimeType, filename) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');

    const uploadEndpoint = `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${GEMINI_API_KEY}`;

    const { FormData, Blob } = await import('node-fetch').then(() => {
      // node-fetch v2 doesn't bundle FormData; use the built-in (Node 18+)
      return { FormData: global.FormData, Blob: global.Blob };
    }).catch(() => ({ FormData: null, Blob: null }));

    // Fallback: multipart upload using raw HTTP
    const boundary = `----GeminiBoundary${Date.now()}`;
    const metaPart = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ file: { displayName: filename } }),
    ].join('\r\n');

    const dataPart = [
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      '',
    ].join('\r\n');

    const closing = `\r\n--${boundary}--`;

    const bodyParts = [
      Buffer.from(metaPart + '\r\n', 'utf8'),
      Buffer.from(dataPart + '\r\n', 'utf8'),
      buffer,
      Buffer.from(closing, 'utf8'),
    ];
    const bodyBuffer = Buffer.concat(bodyParts);

    const uploadResponse = await fetch(uploadEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(bodyBuffer.length),
        'X-Goog-Upload-Protocol': 'multipart',
      },
      body: bodyBuffer,
    });

    if (!uploadResponse.ok) {
      const errBody = await uploadResponse.json().catch(() => ({}));
      throw new Error(
        errBody?.error?.message || `File upload failed with status ${uploadResponse.status}`
      );
    }

    const uploadData = await uploadResponse.json();
    const fileUri = uploadData?.file?.uri;
    if (!fileUri) throw new Error('Gemini Files API did not return a file URI');
    return fileUri;
  }
}

module.exports = GeminiService;
