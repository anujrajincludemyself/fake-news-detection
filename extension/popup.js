/**
 * TruthLens - Popup Script
 * Loads stats and history from chrome.storage, checks server health.
 */

(function () {
  const VERDICT_COLORS = {
    REAL:      '#4ade80',
    FAKE:      '#f87171',
    UNCERTAIN: '#fbbf24',
    SATIRE:    '#c084fc',
  };

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function renderStats(stats) {
    document.getElementById('stat-total').textContent = stats.total || 0;
    document.getElementById('stat-real').textContent = stats.REAL || 0;
    document.getElementById('stat-fake').textContent = stats.FAKE || 0;
    document.getElementById('stat-uncertain').textContent =
      (stats.UNCERTAIN || 0) + (stats.SATIRE || 0);

    const total = stats.total || 0;
    if (total > 0) {
      const ratioSection = document.getElementById('ratio-section');
      ratioSection.style.display = 'block';

      const realPct   = ((stats.REAL || 0) / total * 100).toFixed(1);
      const fakePct   = ((stats.FAKE || 0) / total * 100).toFixed(1);
      const uncertPct = (100 - parseFloat(realPct) - parseFloat(fakePct)).toFixed(1);

      document.getElementById('ratio-real').style.width = realPct + '%';
      document.getElementById('ratio-uncertain-fill').style.width = Math.max(0, uncertPct) + '%';
      document.getElementById('ratio-fake').style.width = fakePct + '%';
      document.getElementById('ratio-text').textContent =
        `${realPct}% real · ${fakePct}% fake`;
    }
  }

  function renderHistory(history) {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('empty-state');

    if (!history || history.length === 0) {
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';
    list.innerHTML = '';

    history.slice(0, 20).forEach(item => {
      const verdict = item.verdict || 'UNCERTAIN';
      const color = VERDICT_COLORS[verdict] || '#94a3b8';

      const a = document.createElement('a');
      a.className = 'history-item';
      a.href = item.url || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = item.url || '';

      a.innerHTML = `
        <div class="history-verdict-dot dot-${verdict}" style="background:${color}"></div>
        <div class="history-info">
          <div class="history-title">${escapeHtml(item.title || item.url || 'Untitled')}</div>
          <div class="history-meta">
            <span class="history-domain">${escapeHtml(item.domain || '')}</span>
            <span class="history-verdict-label verdict-${verdict}">${verdict}</span>
            <span>${timeAgo(item.analyzedAt)}</span>
          </div>
        </div>
        <div class="history-confidence">${item.confidence || 0}%</div>
      `;

      list.appendChild(a);
    });
  }

  function checkServerHealth() {
    const dot = document.getElementById('server-status');
    dot.className = 'server-dot server-checking';
    dot.title = 'Checking server…';

    fetch(`${TL_CONFIG.SERVER_URL}/api/health`, { method: 'GET' })
      .then(r => {
        if (r.ok) {
          dot.className = 'server-dot server-online';
          dot.title = 'Server online';
        } else {
          throw new Error('not ok');
        }
      })
      .catch(() => {
        dot.className = 'server-dot server-offline';
        dot.title = 'Server offline – start the backend';
      });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Load data ────────────────────────────────────────────────────────────────
  chrome.storage.local.get(['tl_stats', 'tl_history'], (data) => {
    renderStats(data.tl_stats || {});
    renderHistory(data.tl_history || []);
  });

  // ─── Clear button ─────────────────────────────────────────────────────────────
  document.getElementById('clear-btn').addEventListener('click', () => {
    if (!confirm('Clear all TruthLens history?')) return;
    chrome.storage.local.remove(['tl_stats', 'tl_history'], () => {
      renderStats({});
      renderHistory([]);
      document.getElementById('ratio-section').style.display = 'none';
    });
  });

  // ─── Auto-analyze toggle ──────────────────────────────────────────────────────
  const autoToggle = document.getElementById('auto-toggle');

  chrome.storage.local.get(['tl_enabled'], (data) => {
    autoToggle.checked = data.tl_enabled === true;
  });

  autoToggle.addEventListener('change', () => {
    chrome.storage.local.set({ tl_enabled: autoToggle.checked });
  });

  // ─── Analyze This Page button ─────────────────────────────────────────────────
  document.getElementById('analyze-btn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'TL_ANALYZE_NOW' }, () => {
        void chrome.runtime.lastError; // suppress error if page has no content script
      });
      window.close();
    });
  });

  // ─── Server health ────────────────────────────────────────────────────────────
  checkServerHealth();
})();
