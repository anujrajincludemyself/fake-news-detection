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
}

module.exports = GroqService;
