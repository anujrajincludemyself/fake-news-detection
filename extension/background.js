/**
 * TruthLens - Background Service Worker
 * Manages extension badge and per-tab analysis state.
 */

// Update the toolbar badge when a tab receives its analysis result
function setBadge(tabId, verdict) {
  const MAP = {
    REAL: { text: '✓', color: '#22c55e' },
    FAKE: { text: '✗', color: '#ef4444' },
    UNCERTAIN: { text: '?', color: '#f59e0b' },
    SATIRE: { text: 'S', color: '#a855f7' },
    ANALYZING: { text: '…', color: '#6366f1' },
    ERROR: { text: '!', color: '#64748b' },
  };
  const entry = MAP[verdict] || MAP['ERROR'];
  chrome.action.setBadgeText({ tabId, text: entry.text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: entry.color });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TL_SET_BADGE') {
    setBadge(sender.tab.id, message.verdict);
  }

  if (message.type === 'TL_SAVE_RESULT') {
    // Single storage read for both history and stats
    chrome.storage.local.get(['tl_history', 'tl_stats'], (data) => {
      const history = data.tl_history || [];
      history.unshift({
        url: message.url,
        title: message.title,
        domain: message.domain,
        verdict: message.verdict,
        confidence: message.confidence,
        credibilityScore: message.credibilityScore,
        analyzedAt: Date.now(),
      });

      const stats = data.tl_stats || { total: 0, REAL: 0, FAKE: 0, UNCERTAIN: 0, SATIRE: 0 };
      stats.total += 1;
      stats[message.verdict] = (stats[message.verdict] || 0) + 1;

      chrome.storage.local.set({
        tl_history: history.slice(0, 50),
        tl_stats: stats,
      });
    });
  }

  // Keep channel open for async
  return false;
});

// Clear badge when navigating away
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});
