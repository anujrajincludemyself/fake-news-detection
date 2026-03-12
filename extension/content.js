/**
 * TruthLens - Content Script
 * Auto-analyzes article text, injects floating overlay with verdict.
 */

(function () {
  'use strict';

  // Prevent double injection
  if (window.__truthlens_injected) return;
  window.__truthlens_injected = true;

  // ─── Constants ───────────────────────────────────────────────────────────────
  const OVERLAY_ID = 'tl-overlay-root';
  let currentResult = null;
  let highlightsActive = false;
  let highlightedNodes = [];
  let isRunning = false;

  // ─── Overlay HTML ─────────────────────────────────────────────────────────────
  function buildOverlayHTML() {
    return `
<div class="tl-widget" id="tl-widget">
  <!-- Loading state -->
  <div class="tl-loading" id="tl-loading">
    <div class="tl-loading-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="4" fill="currentColor"/>
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31 32" stroke-linecap="round"/>
      </svg>
    </div>
    <span>TruthLens analyzing…</span>
  </div>

  <!-- Result pill (collapsed) -->
  <div class="tl-pill" id="tl-pill" style="display:none">
    <div class="tl-pill-icon" id="tl-pill-icon">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/>
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
      </svg>
    </div>
    <span class="tl-pill-verdict" id="tl-pill-verdict">FAKE</span>
    <span class="tl-pill-confidence" id="tl-pill-confidence">87%</span>
    <button class="tl-expand-btn" id="tl-expand-btn" aria-label="Expand TruthLens">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
        <path d="M5 2L9 7H1L5 2Z"/>
      </svg>
    </button>
  </div>

  <!-- Full card (expanded) -->
  <div class="tl-card" id="tl-card" style="display:none">
    <!-- Card header -->
    <div class="tl-card-header">
      <div class="tl-logo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="#818cf8" stroke-width="2"/>
          <circle cx="12" cy="12" r="3" fill="#818cf8"/>
        </svg>
        <span>TruthLens</span>
      </div>
      <div class="tl-header-actions">
        <button class="tl-icon-btn" id="tl-collapse-btn" title="Collapse">
          <svg width="12" height="12" viewBox="0 0 10 10" fill="currentColor"><path d="M5 8L1 3H9L5 8Z"/></svg>
        </button>
        <button class="tl-icon-btn" id="tl-close-btn" title="Dismiss">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Main verdict section -->
    <div class="tl-verdict-section">
      <div class="tl-gauge-wrap">
        <svg class="tl-gauge-svg" viewBox="0 0 120 120" width="88" height="88">
          <circle cx="60" cy="60" r="50" class="tl-gauge-track"/>
          <circle cx="60" cy="60" r="50" class="tl-gauge-fill" id="tl-gauge-fill"
            stroke-dasharray="0 314.16" stroke-dashoffset="-78.54" stroke-linecap="round"/>
        </svg>
        <div class="tl-gauge-label" id="tl-gauge-label">
          <div class="tl-gauge-score" id="tl-gauge-score">—</div>
          <div class="tl-gauge-sub">credible</div>
        </div>
      </div>
      <div class="tl-verdict-info">
        <div class="tl-verdict-badge" id="tl-verdict-badge">ANALYZING</div>
        <div class="tl-confidence-line" id="tl-confidence-line">confidence: —</div>
        <div class="tl-reasoning" id="tl-reasoning">Examining article content…</div>
      </div>
    </div>

    <!-- Metrics row -->
    <div class="tl-metrics" id="tl-metrics" style="display:none">
      <div class="tl-metric-row" id="tl-bias-row">
        <span class="tl-metric-label">Bias</span>
        <div class="tl-bias-meter">
          <span class="tl-bias-left">L</span>
          <div class="tl-bias-track">
            <div class="tl-bias-thumb" id="tl-bias-thumb"></div>
          </div>
          <span class="tl-bias-right">R</span>
          <span class="tl-bias-value" id="tl-bias-value">—</span>
        </div>
      </div>
      <div class="tl-metric-row">
        <span class="tl-metric-label">Emotional</span>
        <div class="tl-bar-wrap">
          <div class="tl-bar" id="tl-emotion-bar"></div>
        </div>
        <span class="tl-metric-pct" id="tl-emotion-pct">0%</span>
      </div>
      <div class="tl-metric-row">
        <span class="tl-metric-label">Clickbait</span>
        <div class="tl-bar-wrap">
          <div class="tl-bar tl-bar-orange" id="tl-clickbait-bar"></div>
        </div>
        <span class="tl-metric-pct" id="tl-clickbait-pct">0%</span>
      </div>
    </div>

    <!-- Red flags & positive signals -->
    <div class="tl-flags" id="tl-flags" style="display:none">
      <div id="tl-red-flags"></div>
      <div id="tl-positive-signals"></div>
    </div>

    <!-- Actions -->
    <div class="tl-actions" id="tl-actions" style="display:none">
      <button class="tl-action-btn" id="tl-highlight-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
        </svg>
        Highlight Suspicious Text
      </button>
      <div class="tl-powered">Powered by Groq AI</div>
    </div>
  </div>
</div>`;
  }

  // ─── Inject Overlay ───────────────────────────────────────────────────────────
  function injectOverlay() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      // Was hidden by dismissOverlay() — make it visible again for the new scan
      existing.style.display = '';
      return;
    }
    const root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.innerHTML = buildOverlayHTML();
    document.body.appendChild(root);
    attachEventListeners();
  }

  function attachEventListeners() {
    const expandBtn = document.getElementById('tl-expand-btn');
    const collapseBtn = document.getElementById('tl-collapse-btn');
    const closeBtn = document.getElementById('tl-close-btn');
    const highlightBtn = document.getElementById('tl-highlight-btn');

    expandBtn?.addEventListener('click', expandCard);
    collapseBtn?.addEventListener('click', collapseCard);
    closeBtn?.addEventListener('click', dismissOverlay);
    highlightBtn?.addEventListener('click', toggleHighlights);
  }

  function expandCard() {
    document.getElementById('tl-pill').style.display = 'none';
    document.getElementById('tl-card').style.display = 'flex';
  }

  function collapseCard() {
    document.getElementById('tl-card').style.display = 'none';
    document.getElementById('tl-pill').style.display = 'flex';
  }

  function dismissOverlay() {
    const root = document.getElementById(OVERLAY_ID);
    if (root) root.style.display = 'none';
    removeHighlights();
  }

  // ─── State Renderers ─────────────────────────────────────────────────────────
  const VERDICT_STYLES = {
    REAL:      { bg: '#166534', color: '#4ade80', label: '✓ REAL' },
    FAKE:      { bg: '#7f1d1d', color: '#f87171', label: '✗ LIKELY FAKE' },
    UNCERTAIN: { bg: '#78350f', color: '#fbbf24', label: '? UNCERTAIN' },
    SATIRE:    { bg: '#3b0764', color: '#c084fc', label: '◈ SATIRE' },
  };

  function scoreColor(score) {
    if (score >= 70) return '#4ade80';
    if (score >= 40) return '#fbbf24';
    return '#f87171';
  }

  function renderLoading() {
    document.getElementById('tl-loading').style.display = 'flex';
    document.getElementById('tl-pill').style.display = 'none';
    document.getElementById('tl-card').style.display = 'none';
    // Reset expand button — renderError() hides it; must restore for next scan
    const expBtn = document.getElementById('tl-expand-btn');
    if (expBtn) expBtn.style.display = '';
  }

  function renderResult(result) {
    currentResult = result;
    const vs = VERDICT_STYLES[result.verdict] || VERDICT_STYLES.UNCERTAIN;

    // --- Pill ---
    const pillVerdict = document.getElementById('tl-pill-verdict');
    const pillConf = document.getElementById('tl-pill-confidence');
    const pillIcon = document.getElementById('tl-pill-icon');
    pillVerdict.textContent = result.verdict;
    pillVerdict.style.color = vs.color;
    pillConf.textContent = result.confidence + '%';
    pillIcon.style.color = vs.color;

    // --- Gauge ---
    const circumference = 314.16; // 2π×50
    const fillEl = document.getElementById('tl-gauge-fill');
    const scoreEl = document.getElementById('tl-gauge-score');
    const score = result.credibilityScore;
    const dash = (score / 100) * circumference;
    fillEl.setAttribute('stroke-dasharray', `${dash} ${circumference}`);
    fillEl.style.stroke = scoreColor(score);
    scoreEl.textContent = score + '%';
    scoreEl.style.color = scoreColor(score);

    // --- Verdict badge ---
    const badge = document.getElementById('tl-verdict-badge');
    badge.textContent = vs.label;
    badge.style.background = vs.bg;
    badge.style.color = vs.color;

    // --- Confidence & reasoning ---
    document.getElementById('tl-confidence-line').textContent =
      `confidence: ${result.confidence}% · via ${result.source || 'AI'}`;
    document.getElementById('tl-reasoning').textContent =
      result.reasoning || 'No reasoning provided.';

    // --- Metrics ---
    const metricsEl = document.getElementById('tl-metrics');
    metricsEl.style.display = 'grid';

    // Bias meter: LEFT=0%, CENTER=50%, RIGHT=100%
    const biasMap = { LEFT: 10, CENTER: 50, RIGHT: 90, UNKNOWN: 50 };
    const biasPos = biasMap[result.bias] ?? 50;
    const thumb = document.getElementById('tl-bias-thumb');
    thumb.style.left = `${biasPos}%`;
    thumb.style.background = vs.color;
    const biasLabel = result.bias === 'UNKNOWN'
      ? 'Not detected'
      : `${result.bias} (${result.biasStrength}%)`;
    document.getElementById('tl-bias-value').textContent = biasLabel;

    // Bar metrics
    setBar('tl-emotion-bar', 'tl-emotion-pct', result.emotionalLanguageScore, '#f87171');
    setBar('tl-clickbait-bar', 'tl-clickbait-pct', result.clickbaitScore, '#fb923c');

    // --- Flags ---
    const flagsEl = document.getElementById('tl-flags');
    const redFlagsEl = document.getElementById('tl-red-flags');
    const posSignalsEl = document.getElementById('tl-positive-signals');
    redFlagsEl.innerHTML = '';
    posSignalsEl.innerHTML = '';

    if (result.redFlags && result.redFlags.length > 0) {
      redFlagsEl.innerHTML = result.redFlags
        .map(f => `<div class="tl-flag tl-flag-red">⚠ ${escapeHtml(f)}</div>`)
        .join('');
      flagsEl.style.display = 'block';
    }
    if (result.positiveSignals && result.positiveSignals.length > 0) {
      posSignalsEl.innerHTML = result.positiveSignals
        .map(s => `<div class="tl-flag tl-flag-green">✓ ${escapeHtml(s)}</div>`)
        .join('');
      flagsEl.style.display = 'block';
    }

    // --- Actions ---
    document.getElementById('tl-actions').style.display = 'flex';

    const highlightBtn = document.getElementById('tl-highlight-btn');
    if (!result.suspiciousSentences || result.suspiciousSentences.length === 0) {
      highlightBtn.style.display = 'none';
    }

    // Update powered-by text
    const poweredBy = document.querySelector('.tl-powered');
    if (result.source === 'groq') {
      poweredBy.textContent = 'Powered by Groq / Llama 3.3';
    } else if (result.source === 'gemini') {
      poweredBy.textContent = 'Powered by Google Gemini';
    } else {
      poweredBy.textContent = 'Powered by AI analysis';
    }

    // Show pill (collapsed by default)
    document.getElementById('tl-loading').style.display = 'none';
    collapseCard();
    document.getElementById('tl-pill').style.display = 'flex';
  }

  function renderError(msg) {
    document.getElementById('tl-loading').style.display = 'none';
    const pill = document.getElementById('tl-pill');
    pill.style.display = 'flex';
    const pv = document.getElementById('tl-pill-verdict');
    pv.textContent = 'ERROR';
    pv.style.color = '#94a3b8';
    document.getElementById('tl-pill-confidence').textContent = '';
    document.getElementById('tl-expand-btn').style.display = 'none';

    // Show simple error card
    document.getElementById('tl-reasoning').textContent = msg;
    document.getElementById('tl-verdict-badge').textContent = 'Could not analyze';
  }

  function setBar(barId, pctId, value, color) {
    const bar = document.getElementById(barId);
    const pct = document.getElementById(pctId);
    bar.style.width = value + '%';
    bar.style.background = color;
    pct.textContent = value + '%';
  }

  // ─── Highlight Suspicious Sentences ──────────────────────────────────────────
  function toggleHighlights() {
    if (highlightsActive) {
      removeHighlights();
    } else {
      applyHighlights();
    }
  }

  function applyHighlights() {
    if (!currentResult || !currentResult.suspiciousSentences?.length) return;
    removeHighlights(); // clear old ones

    const sentences = currentResult.suspiciousSentences;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const skip = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD'];
          if (skip.includes(node.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
          // Don't highlight inside our own overlay
          if (node.parentElement?.closest('#' + OVERLAY_ID)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    sentences.forEach(sentence => {
      const snippet = sentence.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!snippet) return;

      for (const textNode of textNodes) {
        const idx = textNode.textContent.toLowerCase().indexOf(
          snippet.toLowerCase().slice(0, 60)
        );
        if (idx === -1) continue;

        try {
          const range = document.createRange();
          range.setStart(textNode, idx);
          range.setEnd(textNode, Math.min(textNode.length, idx + sentence.length));
          const mark = document.createElement('mark');
          mark.className = 'tl-suspicious-highlight';
          mark.title = 'TruthLens: Suspicious claim';
          range.surroundContents(mark);
          highlightedNodes.push(mark);
          break; // only highlight first occurrence
        } catch {
          // Range may cross element boundaries — skip
        }
      }
    });

    if (highlightedNodes.length > 0) {
      highlightsActive = true;
      const btn = document.getElementById('tl-highlight-btn');
      btn.textContent = '✕ Remove Highlights';
      btn.classList.add('tl-action-btn-active');
      // Scroll to first highlight
      highlightedNodes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function removeHighlights() {
    highlightedNodes.forEach(mark => {
      if (mark.parentNode) {
        const parent = mark.parentNode;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
      }
    });
    highlightedNodes = [];
    highlightsActive = false;

    const btn = document.getElementById('tl-highlight-btn');
    if (btn) {
      btn.textContent = 'Highlight Suspicious Text';
      btn.classList.remove('tl-action-btn-active');
    }
  }

  // ─── API Call ─────────────────────────────────────────────────────────────────
  async function analyzeArticle(articleData) {
    const endpoint = `${TL_CONFIG.SERVER_URL}/api/extension/analyze`;

    // 30-second hard timeout so isRunning is never permanently stuck
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Key': TL_CONFIG.EXTENSION_API_KEY,
        },
        body: JSON.stringify({
          url: articleData.url,
          title: articleData.title,
          content: articleData.content,
          domain: articleData.domain,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `Server error ${response.status}`);
      }

      const json = await response.json();
      return json.data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Analysis timed out — server took too long to respond.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Main Flow ────────────────────────────────────────────────────────────────
  async function run(force = false) {
    // Prevent concurrent API calls
    if (isRunning) return;
    isRunning = true;

    // Only run on article-like pages (skip homepages, short listing pages)
    if (!force && !isArticlePage()) { isRunning = false; return; }

    injectOverlay();
    renderLoading();

    // Wait for dynamic content to settle
    await delay(TL_CONFIG.ANALYSIS_DELAY_MS);

    const article = TL_EXTRACTOR.extract();

    if (article.content.length < TL_CONFIG.MIN_CONTENT_LENGTH) {
      dismissOverlay();
      isRunning = false;
      return;
    }

    // Notify background: set "analyzing" badge
    chrome.runtime.sendMessage({ type: 'TL_SET_BADGE', verdict: 'ANALYZING' });

    try {
      const result = await analyzeArticle(article);
      renderResult(result);

      // Notify background: update badge + save to history
      chrome.runtime.sendMessage({ type: 'TL_SET_BADGE', verdict: result.verdict });
      chrome.runtime.sendMessage({
        type: 'TL_SAVE_RESULT',
        url: article.url,
        title: article.title,
        domain: article.domain,
        verdict: result.verdict,
        confidence: result.confidence,
        credibilityScore: result.credibilityScore,
      });
    } catch (err) {
      console.error('[TruthLens]', err);
      renderError('Could not connect to analysis server. Is it running?');
      chrome.runtime.sendMessage({ type: 'TL_SET_BADGE', verdict: 'ERROR' });
    } finally {
      isRunning = false;
    }
  }

  function isArticlePage() {
    const path = window.location.pathname;
    // Skip root and single-segment paths (homepages, section pages)
    const segments = path.split('/').filter(Boolean);
    if (segments.length < 2) return false;
    // Must have some path depth suggesting an article slug
    return path.length > 15;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────

  // Listen for manual "Analyze Now" trigger from the popup
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TL_ANALYZE_NOW') {
      run(true);
    }
  });

  function bootCheck() {
    chrome.storage.local.get(['tl_enabled'], (data) => {
      if (data.tl_enabled) run();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootCheck);
  } else {
    bootCheck();
  }
})();
