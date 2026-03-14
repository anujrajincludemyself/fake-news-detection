const fetch = require('node-fetch');

const GOOGLE_NEWS_RSS_URL =
  'https://news.google.com/rss/search?q=(rumor%20OR%20hoax%20OR%20fake%20news%20OR%20misinformation)&hl=en-US&gl=US&ceid=US:en';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.0-flash';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const STOP_WORDS = new Set([
  'that', 'with', 'from', 'have', 'this', 'will', 'they', 'their', 'about', 'after', 'before',
  'where', 'what', 'when', 'which', 'into', 'over', 'under', 'more', 'most', 'than', 'just',
  'says', 'said', 'news', 'fake', 'hoax', 'rumor', 'rumours', 'rumors', 'misinformation',
]);

let cachedRumor = null;
let cacheUpdatedAt = 0;

function decodeHtmlEntities(text = '') {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanHeadline(raw = '') {
  const withoutSource = raw.replace(/\s+-\s+[^-]+$/, '');
  return decodeHtmlEntities(withoutSource)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text = '') {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter((word) => !STOP_WORDS.has(word));
}

function scoreHeadlineAgainstKeywords(headline, keywordCounts) {
  const words = tokenize(headline);
  return words.reduce((sum, word) => sum + (keywordCounts.get(word) || 0), 0);
}

function parseRssItems(xml) {
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i;
  const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/i;
  const linkRegex = /<link>(.*?)<\/link>/i;

  const items = [];
  let match = itemRegex.exec(xml);
  while (match) {
    const itemXml = match[1] || '';
    const titleMatch = itemXml.match(titleRegex);
    const pubDateMatch = itemXml.match(pubDateRegex);
    const linkMatch = itemXml.match(linkRegex);

    const rawTitle = titleMatch?.[1] || titleMatch?.[2] || '';
    const title = cleanHeadline(rawTitle);

    if (title) {
      items.push({
        title,
        publishedAt: pubDateMatch?.[1] ? new Date(pubDateMatch[1]).toISOString() : null,
        link: decodeHtmlEntities(linkMatch?.[1] || ''),
      });
    }

    match = itemRegex.exec(xml);
  }

  return items;
}

function pickTrendingRumor(headlines) {
  const keywordCounts = new Map();
  headlines.forEach((headline) => {
    tokenize(headline.title).forEach((word) => {
      keywordCounts.set(word, (keywordCounts.get(word) || 0) + 1);
    });
  });

  const ranked = headlines
    .map((headline) => ({
      ...headline,
      trendScore: scoreHeadlineAgainstKeywords(headline.title, keywordCounts),
    }))
    .sort((a, b) => b.trendScore - a.trendScore);

  const top = ranked[0] || null;
  const topKeywords = [...keywordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word);

  return {
    top,
    topKeywords,
    relatedHeadlines: ranked.slice(0, 5),
  };
}

async function createCatchyLine(headline, keywords) {
  const fallback = `🕵️ Most Believed Lie of the Hour: ${headline}`;
  if (!GEMINI_API_KEY) return fallback;

  const prompt = `Create one short, catchy title for a fake-news dashboard hero card.
Style: bold, dramatic, but not defamatory.
Max 80 characters.
Must include the phrase "Most Believed Lie".

Headline: ${headline}
Keywords: ${keywords.join(', ') || 'trending rumor'}

Return only plain text.`;

  try {
    const response = await fetch(
      `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 80 },
        }),
      }
    );

    if (!response.ok) return fallback;
    const data = await response.json();
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

class WallTrendingService {
  static async getHourlyTrendingRumor({ forceRefresh = false } = {}) {
    const now = Date.now();
    const cacheValid = cachedRumor && now - cacheUpdatedAt < CACHE_TTL_MS;
    if (!forceRefresh && cacheValid) {
      return { ...cachedRumor, cache: { fromCache: true, ttlMs: CACHE_TTL_MS } };
    }

    const response = await fetch(GOOGLE_NEWS_RSS_URL, {
      method: 'GET',
      headers: { 'User-Agent': 'FakeNewsDetective/1.0' },
      timeout: 10000,
    });

    if (!response.ok) {
      throw new Error(`Trending feed unavailable (${response.status})`);
    }

    const xml = await response.text();
    const headlines = parseRssItems(xml);
    if (!headlines.length) {
      throw new Error('No rumor headlines found in trending feed');
    }

    const { top, topKeywords, relatedHeadlines } = pickTrendingRumor(headlines);
    if (!top) {
      throw new Error('Could not determine trending rumor');
    }

    const catchyLine = await createCatchyLine(top.title, topKeywords);

    const payload = {
      catchyLine,
      title: top.title,
      sourceUrl: top.link || null,
      publishedAt: top.publishedAt,
      trendScore: top.trendScore,
      keywords: topKeywords,
      relatedHeadlines: relatedHeadlines.map((item) => ({
        title: item.title,
        sourceUrl: item.link || null,
        publishedAt: item.publishedAt,
      })),
      refreshedAt: new Date().toISOString(),
      nextRefreshAt: new Date(now + CACHE_TTL_MS).toISOString(),
    };

    cachedRumor = payload;
    cacheUpdatedAt = now;

    return { ...payload, cache: { fromCache: false, ttlMs: CACHE_TTL_MS } };
  }
}

module.exports = WallTrendingService;