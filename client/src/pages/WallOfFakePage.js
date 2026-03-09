import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { FiAlertTriangle, FiCheckCircle, FiAlertCircle, FiRefreshCw } from 'react-icons/fi';
import { fetchWall, resetFetched } from '../store/slices/wallSlice';
import './WallOfFakePage.css';

const RISK_GROUPS = [
  {
    key: 'high',
    label: 'High Risk',
    subtitle: '70%+ articles flagged as fake',
    icon: <FiAlertTriangle />,
    colorClass: 'risk-high',
    filter: (s) => s.fakeScore >= 70,
  },
  {
    key: 'moderate',
    label: 'Moderate Risk',
    subtitle: '40–69% articles flagged as fake',
    icon: <FiAlertCircle />,
    colorClass: 'risk-moderate',
    filter: (s) => s.fakeScore >= 40 && s.fakeScore < 70,
  },
  {
    key: 'low',
    label: 'Low Risk',
    subtitle: 'Under 40% articles flagged as fake',
    icon: <FiCheckCircle />,
    colorClass: 'risk-low',
    filter: (s) => s.fakeScore < 40,
  },
];

const VERDICT_COLORS = {
  REAL: '#4ade80',
  FAKE: '#f87171',
  UNCERTAIN: '#fbbf24',
  SATIRE: '#c084fc',
};

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

function SiteCard({ site, rank }) {
  const total = site.totalScans || 1;
  const realPct  = (site.realCount  / total) * 100;
  const fakePct  = (site.fakeCount  / total) * 100;
  const uncertPct = Math.max(0, 100 - realPct - fakePct);

  return (
    <motion.div
      className="wof-card"
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.22 }}
    >
      <div className="wof-card-top">
        <span className="wof-rank">#{rank}</span>
        <div className="wof-domain-wrap">
          <span className="wof-domain">{site.domain}</span>
          <span className="wof-last-scanned">{timeAgo(site.lastScannedAt)}</span>
        </div>
        <span className={`wof-score-badge ${
          site.fakeScore >= 70 ? 'badge-high' : site.fakeScore >= 40 ? 'badge-mod' : 'badge-low'
        }`}>
          {site.fakeScore}% fake
        </span>
      </div>

      <div className="wof-bar">
        <div className="wof-bar-seg wof-real-seg"  style={{ width: `${realPct}%` }} />
        <div className="wof-bar-seg wof-uncert-seg" style={{ width: `${uncertPct}%` }} />
        <div className="wof-bar-seg wof-fake-seg"  style={{ width: `${fakePct}%` }} />
      </div>

      <div className="wof-pills">
        <span className="wof-pill pill-real">✓ {site.realCount} Real</span>
        <span className="wof-pill pill-fake">✗ {site.fakeCount} Fake</span>
        <span className="wof-pill pill-uncert">? {site.uncertainCount + site.satirCount} Uncertain</span>
        <span className="wof-pill pill-total">{site.totalScans} scans</span>
      </div>

      {site.recentArticles && site.recentArticles.length > 0 && (
        <ul className="wof-articles">
          {site.recentArticles.map((a, i) => (
            <li key={i} className="wof-article">
              <span className="wof-a-dot" style={{ background: VERDICT_COLORS[a.verdict] || '#94a3b8' }} />
              <span className="wof-a-title">{a.title || '(no title)'}</span>
              <span className="wof-a-conf">{a.confidence}%</span>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

const WallOfFakePage = () => {
  const dispatch = useDispatch();
  const { sites, loading, error } = useSelector((state) => state.wall);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { dispatch(fetchWall()); }, []);

  const handleRefresh = () => {
    dispatch(resetFetched());
    dispatch(fetchWall()); // resetFetched is synchronous; condition sees lastFetched=null
  };

  const totalScans = sites.reduce((sum, s) => sum + s.totalScans, 0);

  return (
    <div className="wof-page">
      <div className="container">

        <div className="wof-header">
          <div className="wof-header-left">
            <h1 className="wof-title">Wall of Fake</h1>
            <p className="wof-subtitle">
              News sites ranked by credibility — built from community scans via TruthLens.
            </p>
            {sites.length > 0 && (
              <div className="wof-chips">
                <span className="wof-chip">{sites.length} sites tracked</span>
                <span className="wof-chip">{totalScans} articles scanned</span>
              </div>
            )}
          </div>
          <button className="wof-refresh-btn" onClick={handleRefresh} disabled={loading}>
            <FiRefreshCw className={loading ? 'spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {error && <div className="wof-error">⚠ {error}</div>}

        {loading && !sites.length && (
          <div className="wof-loading">
            <div className="wof-spinner" />
            <p>Loading credibility data…</p>
          </div>
        )}

        {!loading && !error && !sites.length && (
          <div className="wof-empty">
            <FiAlertCircle size={40} opacity={0.3} />
            <h3>No data yet</h3>
            <p>Scan articles via the TruthLens extension or the Analyze page to start building the Wall of Fake.</p>
          </div>
        )}

        {RISK_GROUPS.map((group) => {
          const grouped = sites.filter(group.filter);
          if (!grouped.length) return null;
          return (
            <section key={group.key} className={`wof-group ${group.colorClass}`}>
              <div className="wof-group-header">
                <span className="wof-group-icon">{group.icon}</span>
                <div>
                  <div className="wof-group-label">{group.label}</div>
                  <div className="wof-group-meta">
                    {group.subtitle} &nbsp;·&nbsp; <strong>{grouped.length}</strong> site{grouped.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              <div className="wof-grid">
                <AnimatePresence mode="popLayout">
                  {grouped.map((site, i) => (
                    <SiteCard key={site.domain} site={site} rank={i + 1} />
                  ))}
                </AnimatePresence>
              </div>
            </section>
          );
        })}

      </div>
    </div>
  );
};

export default WallOfFakePage;

