import React, { useEffect, useMemo, useCallback, memo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { FiAlertCircle, FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { fetchWall, resetFetched } from '../store/slices/wallSlice';
import './WallOfFakePage.css';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getFakeIndex(site) {
  if (site.fakeScore != null) return Math.round(site.fakeScore);
  const { fakeCount = 0, totalScans = 0 } = site;
  if (totalScans === 0) return 0;
  return Math.round((fakeCount / totalScans) * 100);
}

function getFakeIndexColor(fi) {
  if (fi >= 75) return '#f87171';
  if (fi >= 50) return '#fb923c';
  if (fi >= 25) return '#fbbf24';
  return '#4ade80';
}

function getAvatarColor(domain) {
  const colors = [
    '#a855f7', '#6366f1', '#ec4899', '#f97316',
    '#14b8a6', '#3b82f6', '#ef4444', '#84cc16',
  ];
  let hash = 0;
  for (let i = 0; i < domain.length; i++) hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

const SiteLogo = memo(function SiteLogo({ domain, size = 32 }) {
  const [failed, setFailed] = useState(false);
  const avatarColor = getAvatarColor(domain);
  const handleError = useCallback(() => setFailed(true), []);
  if (failed) {
    return (
      <div className="wof-logo-fallback" style={{ background: avatarColor, width: size, height: size }}>
        {domain.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`}
      alt={domain}
      width={size}
      height={size}
      className="wof-site-logo"
      onError={handleError}
    />
  );
});

/* ─── Podium Card (top 3) ──────────────────────────────────── */
const rankLabels = { 1: '1st', 2: '2nd', 3: '3rd' };
const podiumHeights = { 1: 140, 2: 110, 3: 90 };

const PodiumCard = memo(function PodiumCard({ site, rank }) {
  const fi = getFakeIndex(site);
  const fiColor = getFakeIndexColor(fi);

  return (
    <motion.div
      className={`wof-podium-slot rank-${rank}`}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.1, duration: 0.4 }}
    >
      {/* Card above the pedestal */}
      <div className="wof-pedestal-card">
        <span className={`wof-rank-badge wof-rank-badge-${rank}`}>{rankLabels[rank]}</span>
        <div className="wof-podium-avatar">
          <SiteLogo domain={site.domain} size={48} />
        </div>
        <div className="wof-podium-domain">{site.domain}</div>
        <div className="wof-podium-time">{timeAgo(site.lastScannedAt)}</div>

        <div className="wof-fake-index-badge" style={{ color: fiColor, borderColor: fiColor }}>
          <span className="wof-fi-label">Fake Index</span>
          <span className="wof-fi-value">{fi}%</span>
        </div>

        <div className="wof-podium-pills">
          <span className="wof-pill pill-fake">{site.fakeCount} Fake</span>
          <span className="wof-pill pill-real">{site.realCount} Real</span>
          <span className="wof-pill pill-total">{site.totalScans} scans</span>
        </div>
      </div>

      {/* Pedestal block */}
      <div
        className="wof-pedestal-base"
        style={{ height: podiumHeights[rank], background: fiColor + '18', borderTop: `2px solid ${fiColor}` }}
      >
        <span className="wof-pedestal-rank">#{rank}</span>
      </div>
    </motion.div>
  );
});

/* ─── Leaderboard Row (rank 4+) ────────────────────────────── */
const LeaderRow = memo(function LeaderRow({ site, rank }) {
  const fi = getFakeIndex(site);
  const fiColor = getFakeIndexColor(fi);

  return (
    <motion.div
      className="wof-row"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: (rank - 3) * 0.05, duration: 0.3 }}
    >
      <span className="wof-row-rank">{rank}</span>
      <div className="wof-row-avatar">
        <SiteLogo domain={site.domain} size={32} />
      </div>
      <div className="wof-row-info">
        <span className="wof-row-domain">{site.domain}</span>
        <span className="wof-row-meta">
          {site.fakeCount} Fake &nbsp;·&nbsp; {site.realCount} Real &nbsp;·&nbsp; {site.totalScans} scans
        </span>
      </div>
      <div className="wof-row-right">
        <span className="wof-row-time">{timeAgo(site.lastScannedAt)}</span>
        <span className="wof-row-fi" style={{ color: fiColor }}>
          <span className="wof-row-fi-label">Fake Index: </span>
          {fi}%
        </span>
      </div>
    </motion.div>
  );
});

/* ─── Main Page ─────────────────────────────────────────────── */
const WallOfFakePage = () => {
  const dispatch = useDispatch();
  const sites = useSelector((state) => state.wall.sites);
  const loading = useSelector((state) => state.wall.loading);
  const error = useSelector((state) => state.wall.error);

  useEffect(() => { dispatch(fetchWall()); }, [dispatch]);

  const handleRefresh = useCallback(() => {
    dispatch(resetFetched());
    dispatch(fetchWall());
  }, [dispatch]);

  // Derived data — recompute only when sites array reference changes
  const sorted = useMemo(
    () => [...sites].sort((a, b) => getFakeIndex(b) - getFakeIndex(a)),
    [sites]
  );
  const top3 = useMemo(() => sorted.slice(0, 3), [sorted]);
  const rest = useMemo(() => sorted.slice(3), [sorted]);
  const totalScans = useMemo(() => sites.reduce((sum, s) => sum + s.totalScans, 0), [sites]);

  return (
    <div className="wof-page">
      <div className="container">

        {/* Header */}
        <div className="wof-header">
          <div className="wof-header-left">
            <h1 className="wof-title">Wall of Fake</h1>
            <p className="wof-subtitle">
              News sites ranked by Fake Index — the ratio of fake to real articles detected.
            </p>
            {sites.length > 0 && (
              <div className="wof-chips">
                <span className="wof-chip">{sites.length} sites tracked</span>
                <span className="wof-chip">{totalScans} articles scanned</span>
                <span className="wof-chip wof-chip-info">
                  Fake Index = fake ÷ total × 100
                </span>
              </div>
            )}
          </div>
          <button className="wof-refresh-btn" onClick={handleRefresh} disabled={loading}>
            <FiRefreshCw className={loading ? 'spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {error && <div className="wof-error"><FiAlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{error}</div>}

        {loading && !sites.length && (
          <div className="wof-loading">
            <div className="wof-spinner" />
            <p>Loading leaderboard…</p>
          </div>
        )}

        {!loading && !error && !sites.length && (
          <div className="wof-empty">
            <FiAlertCircle size={40} opacity={0.3} />
            <h3>No data yet</h3>
            <p>Scan articles via the Analyze page to start building the Wall of Fake.</p>
          </div>
        )}

        {sorted.length > 0 && (
          <>
            {/* ── Podium ── */}
            {top3.length > 0 && (
              <div className="wof-podium-wrap">
                <h2 className="wof-section-title">Top Offenders</h2>
                <div className="wof-podium">
                  {/* Reorder visually: 2 | 1 | 3 */}
                  {top3.length >= 2 && <PodiumCard site={top3[1]} rank={2} />}
                  {top3.length >= 1 && <PodiumCard site={top3[0]} rank={1} />}
                  {top3.length >= 3 && <PodiumCard site={top3[2]} rank={3} />}
                </div>
              </div>
            )}

            {/* ── Leaderboard list ── */}
            {rest.length > 0 && (
              <div className="wof-leaderboard-wrap">
                <h2 className="wof-section-title">Full Rankings</h2>
                <div className="wof-leaderboard">
                  <div className="wof-leaderboard-header">
                    <span>Rank</span>
                    <span>Site</span>
                    <span></span>
                    <span className="wof-lh-right">Fake Index</span>
                  </div>
                  <AnimatePresence>
                    {rest.map((site, i) => (
                      <LeaderRow key={site.domain} site={site} rank={i + 4} />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
};

export default WallOfFakePage;
