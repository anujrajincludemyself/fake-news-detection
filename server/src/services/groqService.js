const fetch = require('node-fetch');
const logger = require('../utils/logger');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

class GroqService {
  static async analyzeText(text) {
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 256,
        messages: [
          {
            role: 'system',
            content: `You are a professional fact-checking AI. Analyze news content and classify it.

Rules:
- If events described are physically impossible or wildly implausible (animals using technology, fictional science), classify as FAKE even if written in journalistic tone
- Satire, parody, and absurdist fiction = FAKE
- Only verified, plausible, factually consistent content = REAL
- When uncertain = UNCERTAIN

Respond ONLY with raw JSON, no markdown:
{"label":"REAL"|"FAKE"|"UNCERTAIN","confidence":<0-100>,"reasoning":"<one sentence>"}`,
          },
          {
            role: 'user',
            content: `Analyze this news content:\n\n${text.slice(0, 3000)}`,
          },
        ],
      }),
    });

    if (response.status === 429) {
      const err = new Error('Groq rate limit hit');
      err.isRateLimit = true;
      throw err;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Groq API returned ${response.status}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse Groq response as JSON');
      parsed = JSON.parse(match[0]);
    }

    const label = String(parsed.label || '').toUpperCase();
    const validLabel = ['REAL', 'FAKE', 'UNCERTAIN'].includes(label) ? label : 'UNCERTAIN';

    return {
      label: validLabel,
      confidence: Math.min(100, Math.max(0, Math.round(Number(parsed.confidence) || 50))),
      details: {
        source: 'groq',
        model: MODEL,
        reasoning: parsed.reasoning || '',
      },
    };
  }

  /**
   * Stage 2 of the two-stage image pipeline.
   * Receives a plain-text image description (from BLIP) + the user's claim
   * and uses the fast text model to produce a verdict — no vision quota used.
   * @param {string} imageDescription  caption from BLIP
   * @param {string} userClaim         what the image is alleged to show/prove
   */
  static async analyzeImageClaim(imageDescription, userClaim = '') {
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

    const claimLine = userClaim
      ? `The image is being shared with this claim: "${userClaim}"`
      : 'No specific claim was provided about this image.';

    const userMessage = `Image description: "${imageDescription}"\n\n${claimLine}`;
    logger.info('[Stage-2 analyzeImageClaim] user message sent to Groq →\n' + userMessage);

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 256,
        messages: [
          {
            role: 'system',
            content: `You are a media fact-checking AI. You will receive a description of what an image visually shows, and a claim that the image is allegedly being used to support.

IMPORTANT: Image descriptions only capture what is visually obvious — they cannot mention team names, exact dates, or specific event names. You must reason about whether the visual evidence is CONSISTENT with the claim.

Rules:
- If the visual description is consistent with the claim and nothing in it contradicts the claim → REAL
- Only return FAKE if the description directly contradicts a key fact in the claim (e.g. claim says "flood" but image shows a sunny beach)
- Only return UNCERTAIN if the description is so vague or unrelated that no connection can be made at all
- Blue/orange cricket uniforms + ICC T20 trophy + celebration → consistent with any India T20 World Cup claim
- Presence of recognisable symbols, uniforms, settings, or context is sufficient — exact names are not required

Respond ONLY with raw JSON, no markdown:
{"label":"REAL"|"FAKE"|"UNCERTAIN","confidence":<0-100>,"reasoning":"<one sentence>"}`,
          },
          {
            role: 'user',
            content: `Image description: "${imageDescription}"\n\n${claimLine}`,
          },
        ],
      }),
    });

    if (response.status === 429) {
      const err = new Error('Groq rate limit hit');
      err.isRateLimit = true;
      throw err;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Groq API returned ${response.status}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    logger.info('[Stage-2 analyzeImageClaim] raw Groq response → ' + raw);
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse Groq response as JSON');
      parsed = JSON.parse(match[0]);
    }

    const label = String(parsed.label || '').toUpperCase();
    const validLabel = ['REAL', 'FAKE', 'UNCERTAIN'].includes(label) ? label : 'UNCERTAIN';

    return {
      label: validLabel,
      confidence: Math.min(100, Math.max(0, Math.round(Number(parsed.confidence) || 50))),
      details: {
        source: 'groq-text',
        model: MODEL,
        reasoning: parsed.reasoning || '',
        imageDescription,
      },
    };
  }

  /**
   * Stage 3 — fact-checks the claim itself with full image context.
   * Only called when Stage 2 confirmed the image visually matches the claim.
   * Uses a much more lenient prompt than analyzeText to avoid false positives
   * on real events (sporting wins, elections, disasters, etc.).
   */
  static async factCheckImageClaim(imageDescription, userClaim) {
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

    const factMessage = `Image shows: "${imageDescription}"\n\nClaim to fact-check: "${userClaim}"`;
    logger.info('[Stage-3 factCheckImageClaim] user message sent to Groq →\n' + factMessage);

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 256,
        messages: [
          {
            role: 'system',
            content: `You are a careful fact-checking AI specialising in verifying claims associated with images.

Context: The image has already been visually confirmed to match the claim.
Your job is ONLY to assess whether the underlying claim is factually accurate — did this event actually happen, and are the key details correct?

Rules:
- This is a SHORT CLAIM, not a news article. Do not penalise brevity.
- Well-known sporting events, elections, disasters, and public celebrations are verifiable facts. If image evidence confirms it and you have knowledge it occurred, return REAL.
- Only mark FAKE if you have strong specific knowledge this event did NOT happen, or critical details (winner, date, location) are clearly wrong.
- If you are not confident enough to call it FAKE, return UNCERTAIN — never guess FAKE.
- A claim can reference a past event even if phrased without a date. Judge the substance, not the phrasing.

Respond ONLY with raw JSON, no markdown:
{"label":"REAL"|"FAKE"|"UNCERTAIN","confidence":<0-100>,"reasoning":"<one sentence>"}`,
          },
          {
            role: 'user',
            content: `Image shows: "${imageDescription}"\n\nClaim to fact-check: "${userClaim}"`,
          },
        ],
      }),
    });

    if (response.status === 429) {
      const err = new Error('Groq rate limit hit');
      err.isRateLimit = true;
      throw err;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Groq API returned ${response.status}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    logger.info('[Stage-3 factCheckImageClaim] raw Groq response → ' + raw);
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse Groq fact-check response as JSON');
      parsed = JSON.parse(match[0]);
    }

    const label = String(parsed.label || '').toUpperCase();
    const validLabel = ['REAL', 'FAKE', 'UNCERTAIN'].includes(label) ? label : 'UNCERTAIN';

    return {
      label: validLabel,
      confidence: Math.min(100, Math.max(0, Math.round(Number(parsed.confidence) || 50))),
      details: {
        source: 'groq-factcheck',
        model: MODEL,
        reasoning: parsed.reasoning || '',
      },
    };
  }

  // ─── Vision: describe image only (no verdict) ──────────────────────────────
  /**
   * Uses llama-4-scout to extract a plain-text description of an image.
   * Returns only a description string — no FAKE/REAL verdict.
   * This is Stage 1 when HuggingFace BLIP is unavailable.
   */
  static async describeImage(imageBuffer, mimeType) {
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

    const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
    const base64 = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0.1,
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe what is literally happening in this image in one or two factual sentences. Only describe what you can see — do not judge authenticity or make any verdict.',
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
      }),
    });

    if (response.status === 429) {
      const err = new Error('Groq vision rate limit hit');
      err.isRateLimit = true;
      throw err;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Groq vision API returned ${response.status}`);
    }

    const data = await response.json();
    const description = data?.choices?.[0]?.message?.content?.trim() || '';
    if (!description) throw new Error('Groq vision returned empty description');
    return description;
  }

  // ─── Vision fallback (llama-4-scout full verdict) — last resort only ─────────
  static async analyzeImage(imageBuffer, mimeType, userClaim = '') {
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

    const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
    const base64 = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const claimContext = userClaim
      ? `The image is being shared with this claim: "${userClaim}"\n\n`
      : '';

    const prompt = `You are a media forensics and fact-checking AI.
${claimContext}Examine this image carefully and determine:
1. What the image actually shows (describe briefly)
2. Whether it appears digitally manipulated or AI-generated
3. If a claim was provided, whether the image genuinely supports that claim or contradicts/misrepresents it

Classify as:
- FAKE: image is manipulated/AI-generated, OR it contradicts/misrepresents the claim it accompanies
- REAL: image appears authentic AND supports the claim (or no claim provided and image looks genuine)
- UNCERTAIN: cannot determine with confidence

Respond ONLY with raw JSON, no markdown:
{"label":"REAL"|"FAKE"|"UNCERTAIN","confidence":<0-100>,"reasoning":"<one sentence>","description":"<brief description of what the image shows>"}`;

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
      }),
    });

    if (response.status === 429) {
      const err = new Error('Groq vision rate limit hit');
      err.isRateLimit = true;
      throw err;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Groq vision API returned ${response.status}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse Groq vision response as JSON');
      parsed = JSON.parse(match[0]);
    }

    const label = String(parsed.label || '').toUpperCase();
    const validLabel = ['REAL', 'FAKE', 'UNCERTAIN'].includes(label) ? label : 'UNCERTAIN';

    return {
      label: validLabel,
      confidence: Math.min(100, Math.max(0, Math.round(Number(parsed.confidence) || 50))),
      details: {
        source: 'groq-vision',
        model: VISION_MODEL,
        reasoning: parsed.reasoning || '',
        imageDescription: parsed.description || '',
      },
    };
  }
}

module.exports = GroqService;
