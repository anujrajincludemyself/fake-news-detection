const fetch = require('node-fetch');
const sharp = require('sharp');
const logger = require('../utils/logger');

// Max dimension for images sent to vision APIs.
// Keeps token count low — sufficient for a description task.
const MAX_VISION_PX = 768;

/**
 * Resize an image so its longest side is ≤ MAX_VISION_PX.
 * Returns a JPEG Buffer and 'image/jpeg' as the effective mime type.
 * @param {Buffer} buffer  Original image buffer
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
async function resizeForVision(buffer) {
  const resized = await sharp(buffer)
    .resize({ width: MAX_VISION_PX, height: MAX_VISION_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { buffer: resized, mimeType: 'image/jpeg' };
}

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
const VISION_MODEL = 'pixtral-12b-2409';

class MistralService {
  /**
   * Describes what is literally visible in an image — no verdict, no judgment.
   * Returns a plain string that is passed to Groq text for fact-checking.
   * @param {Buffer} imageBuffer
   * @param {string} mimeType  e.g. 'image/jpeg'
   * @returns {Promise<string>}
   */
  static async describeImage(imageBuffer, mimeType) {
    if (!MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY not configured');

    // Resize before encoding — vision token cost scales with pixel count.
    // Without this a 2.5 MB JPEG can consume the entire free-tier daily quota
    // in a single request.
    const { buffer: resizedBuffer, mimeType: effectiveMime } = await resizeForVision(imageBuffer);
    logger.info(`[Mistral] image resized to ≤${MAX_VISION_PX}px (${resizedBuffer.length} bytes, was ${imageBuffer.length} bytes)`);

    const base64 = resizedBuffer.toString('base64');
    const dataUrl = `data:${effectiveMime};base64,${base64}`;

    const response = await fetch(MISTRAL_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0.1,
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe what is literally happening in this image in two or three factual sentences. Only describe what you can physically see — people, objects, setting, text, logos, actions. Do not judge whether the image is real, fake, or manipulated.',
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl },
            },
          ],
        }],
      }),
    });

    if (response.status === 429) {
      const err = new Error('Mistral rate limit hit');
      err.isRateLimit = true;
      throw err;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.message || `Mistral API returned ${response.status}`);
    }

    const data = await response.json();
    const description = data?.choices?.[0]?.message?.content?.trim() || '';
    if (!description) throw new Error('Mistral returned empty description');
    return description;
  }
}

module.exports = MistralService;
