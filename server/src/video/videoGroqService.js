/**
 * videoGroqService.js
 * ────────────────────
 * Groq-powered calls specific to video analysis.
 *
 * Three-stage pipeline:
 *   Stage 1 – describeFrame()         : vision model describes each frame
 *   Stage 2 – synthesizeSummary()     : text model writes a coherent video summary
 *   Stage 3 – factCheckVideoContent() : text model verifies summary vs user's context
 */

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const TEXT_MODEL = 'llama-3.3-70b-versatile';

function requireKey() {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');
}

async function postGroq(body) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const err = new Error('Groq rate limit hit');
    err.isRateLimit = true;
    throw err;
  }
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.error?.message || `Groq API returned ${res.status}`);
  }
  return res.json();
}

function parseJsonResponse(raw) {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse Groq response as JSON');
    return JSON.parse(match[0]);
  }
}

// ─── Stage 1: Describe a single video frame ───────────────────────────────────
/**
 * @param {Buffer} frameBuffer  JPEG frame
 * @param {number} index        1-based frame number
 * @param {number} totalFrames  total frame count (for context)
 * @param {string} timestamp    approximate timestamp string e.g. "5.0s"
 * @returns {Promise<string>}   plain-text description
 */
async function describeFrame(frameBuffer, index, totalFrames, timestamp) {
  requireKey();
  const base64 = frameBuffer.toString('base64');
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const data = await postGroq({
    model: VISION_MODEL,
    temperature: 0.1,
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `This is frame ${index} of ${totalFrames} from a video (approximate timestamp: ${timestamp}).
Describe exactly what you can see in this frame in 1-2 factual sentences.
Focus on: people, objects, text, setting, actions, expressions. Do not judge authenticity.`,
          },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const description = data?.choices?.[0]?.message?.content?.trim() || '';
  logger.info(`[Video Frame ${index}/${totalFrames} @ ${timestamp}] ${description}`);
  return description || `Frame ${index}: No description available.`;
}

// ─── Stage 2: Synthesise frame descriptions into a coherent video summary ─────
/**
 * @param {Array<{description: string, timestamp: string, index: number}>} frames
 * @param {string} userContext  what the user says the video is about
 * @returns {Promise<string>}   rich summary of video content
 */
async function synthesizeSummary(frames, userContext) {
  requireKey();

  const frameList = frames
    .map((f) => `  Frame ${f.index} (${f.timestamp}): ${f.description}`)
    .join('\n');

  const contextLine = userContext
    ? `The user claims this video is about: "${userContext}"`
    : 'No context was provided by the user.';

  const data = await postGroq({
    model: TEXT_MODEL,
    temperature: 0.2,
    max_tokens: 400,
    messages: [
      {
        role: 'system',
        content: `You are a video content analyst. Given a sequence of frame descriptions extracted from a video, 
write a clear, concise summary of what the entire video appears to show and depict.
Do not judge whether the video is real or fake — only describe what is visually present.
Write 2-4 sentences maximum.`,
      },
      {
        role: 'user',
        content: `${contextLine}\n\nFrame-by-frame descriptions:\n${frameList}\n\nWrite a concise video content summary:`,
      },
    ],
  });

  const summary = data?.choices?.[0]?.message?.content?.trim() || '';
  logger.info(`[Video Synthesis] Summary: ${summary}`);
  return summary;
}

// ─── Stage 3: Fact-check the video content against the user's context ─────────
/**
 * @param {string} videoSummary  synthesised description of what's in the video
 * @param {string} userContext   what the user claims the video is about
 * @returns {Promise<{label: string, confidence: number, details: object}>}
 */
async function factCheckVideoContent(videoSummary, userContext) {
  requireKey();

  const contextLine = userContext
    ? `The video is being shared with this claim: "${userContext}"`
    : 'No specific claim was provided about this video.';

  const data = await postGroq({
    model: TEXT_MODEL,
    temperature: 0.1,
    max_tokens: 300,
    messages: [
      {
        role: 'system',
        content: `You are a video fact-checking AI. You will receive a description of what a video visually shows (extracted from frames) and an optional claim the video is being used to support.

Rules:
- If the video content is consistent with the claim and nothing contradicts it → REAL
- Only return FAKE if the video description directly contradicts a key fact in the claim
- Only return UNCERTAIN if the content is too vague or unrelated to make a determination
- If no context was provided, assess whether the video content appears authentic and internally consistent

Respond ONLY with raw JSON, no markdown:
{"label":"REAL"|"FAKE"|"UNCERTAIN","confidence":<0-100>,"reasoning":"<one clear sentence explaining your verdict>"}`,
      },
      {
        role: 'user',
        content: `Video content summary: "${videoSummary}"\n\n${contextLine}`,
      },
    ],
  });

  const raw = data?.choices?.[0]?.message?.content || '';
  logger.info(`[Video FactCheck] raw → ${raw}`);
  const parsed = parseJsonResponse(raw);

  const label = String(parsed.label || '').toUpperCase();
  const validLabel = ['REAL', 'FAKE', 'UNCERTAIN'].includes(label) ? label : 'UNCERTAIN';

  return {
    label: validLabel,
    confidence: Math.min(100, Math.max(0, Math.round(Number(parsed.confidence) || 50))),
    details: {
      source: 'groq-video',
      textModel: TEXT_MODEL,
      visionModel: VISION_MODEL,
      reasoning: parsed.reasoning || '',
    },
  };
}

module.exports = { describeFrame, synthesizeSummary, factCheckVideoContent };
