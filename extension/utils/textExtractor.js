/**
 * TruthLens - Smart Article Text Extractor
 * Extracts the main article body from news pages, stripping nav/ads/footer.
 */

const TL_EXTRACTOR = (() => {
  // Ordered selectors: most-specific first
  const ARTICLE_SELECTORS = [
    'article[class*="article"]',
    'article[class*="story"]',
    'article[class*="post"]',
    '[itemprop="articleBody"]',
    '[class*="article-body"]',
    '[class*="article__body"]',
    '[class*="story-body"]',
    '[class*="post-body"]',
    '[class*="entry-content"]',
    '[class*="post-content"]',
    '[class*="content-body"]',
    '[class*="news-body"]',
    '[class*="body-text"]',
    '.ArticleBody',
    '.article-content',
    '.story-content',
    '.RichTextArticleBody',
    'article',
    '[role="main"] .body',
    'main article',
  ];

  // Elements to strip from extracted content
  const NOISE_SELECTORS = [
    'nav', 'header', 'footer', 'aside',
    '[class*="ad"]', '[class*="promo"]', '[class*="banner"]',
    '[class*="newsletter"]', '[class*="signup"]', '[class*="subscribe"]',
    '[class*="related"]', '[class*="recommended"]', '[class*="more-stories"]',
    '[class*="social"]', '[class*="share"]', '[class*="comment"]',
    'script', 'style', 'noscript', 'figure figcaption',
  ];

  function getTitle() {
    // Priority: og:title → twitter:title → h1 → document.title
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) return og.content.trim();
    const tw = document.querySelector('meta[name="twitter:title"]');
    if (tw && tw.content) return tw.content.trim();
    const h1 = document.querySelector('article h1, main h1, h1');
    if (h1 && h1.textContent) return h1.textContent.trim();
    return document.title.split('|')[0].split('–')[0].trim();
  }

  function getDomain() {
    return window.location.hostname.replace(/^www\./, '');
  }

  function cloneWithoutNoise(el) {
    const clone = el.cloneNode(true);
    NOISE_SELECTORS.forEach(sel => {
      clone.querySelectorAll(sel).forEach(n => n.remove());
    });
    return clone;
  }

  function extractParagraphs(root) {
    const paragraphs = [];
    root.querySelectorAll('p, h2, h3, h4, blockquote').forEach(el => {
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (text.length > 40) paragraphs.push(text);
    });
    return [...new Set(paragraphs)]; // deduplicate
  }

  function extract() {
    let articleEl = null;

    for (const selector of ARTICLE_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) {
        const textLen = el.textContent.replace(/\s+/g, ' ').trim().length;
        if (textLen > 300) {
          articleEl = el;
          break;
        }
      }
    }

    // Fallback: use <main> or all page paragraphs
    if (!articleEl) {
      articleEl = document.querySelector('main') ||
        document.querySelector('[role="main"]') ||
        document.body;
    }

    const cleaned = cloneWithoutNoise(articleEl);
    const paragraphs = extractParagraphs(cleaned);
    const content = paragraphs.join(' ');

    return {
      title: getTitle(),
      content,
      domain: getDomain(),
      url: window.location.href,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      paragraphCount: paragraphs.length,
    };
  }

  return { extract };
})();
