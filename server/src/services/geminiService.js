const fetch = require('node-fetch');
const logger = require('../utils/logger');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.0-flash';

class GeminiService {
  static async _post(body) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

    const url = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      const errBody = await response.json().catch(() => ({}));
      const err = new Error(errBody?.error?.message || 'Gemini rate limit exceeded');
      err.isRateLimit = true;
      throw err;
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `Gemini API returned ${response.status}`);
    }

    return response.json();
  }

  static _parse(data) {
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse Gemini response');
      parsed = JSON.parse(match[0]);
    }

    const label = String(parsed.label || '').toUpperCase();
    const validLabel = ['REAL', 'FAKE', 'UNCERTAIN'].includes(label) ? label : 'UNCERTAIN';

    return {
      label: validLabel,
      confidence: Math.min(100, Math.max(0, Math.round(Number(parsed.confidence) || 50))),
      details: {
        source: 'gemini',
        reasoning: parsed.reasoning || parsed.explanation || '',
      },
    };
  }

  static async analyzeText(text) {
    const data = await this._post({
      contents: [{
        parts: [{
          text: `You are a professional fact-checking AI. Analyze the following news content.

Rules:
- Physically impossible or wildly implausible events (animals using technology, fictional science) = FAKE even if written in journalistic tone
- Satire, parody, absurdist fiction = FAKE
- Only verified, plausible, factually consistent content = REAL
- When uncertain = UNCERTAIN

Respond ONLY with raw JSON, no markdown:
{"label":"REAL"|"FAKE"|"UNCERTAIN","confidence":<0-100>,"reasoning":"<one sentence>"}

News content:
${text.slice(0, 2000)}`,
        }],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
    });

    return this._parse(data);
  }

  static async analyzeImage(imageBuffer, mimeType) {
    const data = await this._post({
      contents: [{
        parts: [
          {
            text: `You are a media forensics AI. Examine this image.
Is it digitally manipulated, AI-generated, or used out of context to spread misinformation?

Respond ONLY with raw JSON, no markdown:
{"label":"REAL"|"FAKE"|"UNCERTAIN","confidence":<0-100>,"reasoning":"<one sentence>"}`,
          },
          { inlineData: { mimeType, data: imageBuffer.toString('base64') } },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
    });

    return this._parse(data);
  }
}

module.exports = GeminiService;
