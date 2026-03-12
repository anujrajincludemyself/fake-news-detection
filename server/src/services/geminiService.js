const fetch = require('node-fetch');
const sharp = require('sharp');
const logger = require('../utils/logger');

// Max dimension for images sent to vision APIs.
const MAX_VISION_PX = 768;

/**
 * Resize an image so its longest side is ≤ MAX_VISION_PX.
 * Returns a JPEG Buffer.
 * @param {Buffer} buffer
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
async function resizeForVision(buffer) {
  const resized = await sharp(buffer)
    .resize({ width: MAX_VISION_PX, height: MAX_VISION_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { buffer: resized, mimeType: 'image/jpeg' };
}

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

  /**
   * Describes what is literally visible in an image — no verdict, no judgment.
   * Returns a plain string that can be fed into a text fact-checker.
   */
  static async describeImage(imageBuffer, mimeType) {
    // Resize before encoding — vision token cost scales with pixel count.
    const { buffer: resizedBuffer, mimeType: effectiveMime } = await resizeForVision(imageBuffer);
    logger.info(`[Gemini] image resized to ≤${MAX_VISION_PX}px (${resizedBuffer.length} bytes, was ${imageBuffer.length} bytes)`);

    const data = await this._post({
      contents: [{
        parts: [
          {
            text: 'Describe what is literally happening in this image in two or three factual sentences. Only describe what you can physically see — people, objects, setting, text, logos, actions. Do not judge whether it is real or fake.',
          },
          { inlineData: { mimeType: effectiveMime, data: resizedBuffer.toString('base64') } },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
    });

    const description = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!description) throw new Error('Gemini returned empty description');
    return description;
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
