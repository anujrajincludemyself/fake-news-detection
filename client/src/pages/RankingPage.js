import React, { useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiAlertTriangle, FiCheckCircle, FiAlertCircle,
  FiTrendingUp, FiTrendingDown, FiRefreshCw,
  FiGlobe, FiChevronLeft, FiChevronRight,
} from 'react-icons/fi';
import { HiOutlineChartBar } from 'react-icons/hi';
import {
  fetchRankings,
  fetchRankingStats,
  fetchTopFake,
  fetchMostReliable,
  setSort,
  setMinScans,
} from '../store/slices/rankingSlice';
import './RankingPage.css';

// ── Helpers ────────────────────────────────────────────────────────────────

const RISK_META = {
  HIGH:     { label: 'High Risk',     color: '#f87171', bg: 'rgba(248,113,113,0.1)',  border: 'rgba(248,113,113,0.3)' },
  MODERATE: { label: 'Moderate Risk', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.3)'  },
  LOW:      { label: 'Low Risk',      color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.3)'  },
};

const SORT_OPTIONS = [
  { value: 'fakeScore_desc',  label: 'Most Fake First'     },
  { value: 'fakeScore_asc',   label: 'Most Reliable First' },
  { value: 'totalScans_desc', label: 'Most Scanned'        },
  { value: 'domain_asc',      label: 'Domain A–Z'          },
];

function RiskBadge({ level }) {
  const meta = RISK_META[level] || RISK_META.LOW;
  return (
    <span
      className="rl-risk-badge"
      style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}
    >
      {level === 'HIGH' && <FiAlertTriangle />}
      {level === 'MODERATE' && <FiAlertCircle />}
      {level === 'LOW' && <FiCheckCircle />}
      {meta.label}
    </span>
  );
}

function ScoreBar({ fakeScore }) {
  const realPct = Math.max(0, 100 - fakeScore);
  return (
    <div className="rl-score-bar" title={`${fakeScore.toFixed(1)}% fake`}>
      <div className="rl-bar-real"  style={{ width: `${realPct}%` }} />
      <div className="rl-bar-fake"  style={{ width: `${fakeScore}%` }} />
    </div>
  );
}

function RankMedal({ rank }) {
  if (rank === 1) return <span className="rl-medal medal-gold">🥇</span>;
  if (rank === 2) return <span className="rl-medal medal-silver">🥈</span>;
  if (rank === 3) return <span className="rl-medal medal-bronze">🥉</span>;
  return <span className="rl-rank-num">#{rank}</span>;
}

// ── Stat card ──────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, accentColor }) {
  return (
    <div className="rl-stat-card" style={{ borderTopColor: accentColor }}>
      <div className="rl-stat-icon" style={{ color: accentColor }}>{icon}</div>
      <div className="rl-stat-value">{value}</div>
      <div className="rl-stat-label">{label}</div>
      {sub && <div className="rl-stat-sub">{sub}</div>}
    </div>
  );
}

// ── Spotlight item (top fake / most reliable) ──────────────────────────────

function SpotlightItem({ site, index, mode }) {
  const isFake = mode === 'fake';
  const score  = isFake ? site.fakeScore : (100 - site.fakeScore);
  return (
    <div className={`rl-spotlight-item ${isFake ? 'sl-fake' : 'sl-reliable'}`}>
      <div className="rl-sl-rank">
        {index < 3
          ? ['🥇','🥈','🥉'][index]
          : <span className="rl-sl-num">#{index + 1}</span>}
      </div>
      <div className="rl-sl-info">
        <span className="rl-sl-domain">{site.domain}</span>
        <span className="rl-sl-scans">{site.totalScans} scans</span>
      </div>
      <div className="rl-sl-score" style={{ color: isFake ? '#f87171' : '#4ade80' }}>
        {score.toFixed(1)}%
        {isFake ? <FiTrendingUp /> : <FiTrendingDown />}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function RankingPage() {
  const dispatch = useDispatch();
  const {
    sites, pagination, stats,
    topFake, mostReliable,
    loading, statsLoading,
    error,
    currentSort, currentMinScans,
  } = useSelector((state) => state.ranking);

  const loadPage = useCallback(
    (page = 1) => {
      dispatch(fetchRankings({ page, limit: 20, sort: currentSort, minScans: currentMinScans }));
    },
    [dispatch, currentSort, currentMinScans]
  );

  // Initial data load
  useEffect(() => {
    loadPage(1);
    dispatch(fetchRankingStats());
    dispatch(fetchTopFake({ limit: 5 }));
    dispatch(fetchMostReliable({ limit: 5 }));
  }, [dispatch, loadPage]);

  // Re-fetch when sort / minScans changes
  const handleSortChange = (e) => {
    dispatch(setSort(e.target.value));
  };
  useEffect(() => {
    loadPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSort, currentMinScans]);

  const handleRefresh = () => {
    loadPage(pagination.page || 1);
    dispatch(fetchRankingStats());
    dispatch(fetchTopFake({ limit: 5 }));
    dispatch(fetchMostReliable({ limit: 5 }));
  };

  const risk = stats?.riskBreakdown || { HIGH: 0, MODERATE: 0, LOW: 0 };

  return (
    <div className="rl-page container">

      {/* ── Header ─────────────────────────────────────── */}
      <div className="rl-header">
        <div className="rl-header-left">
          <h1 className="rl-title">Media Credibility Rankings</h1>
          <p className="rl-subtitle">
            Sites ranked by fake-news percentage detected across all analysed articles.
            Lower fake score = more trustworthy.
          </p>
          <div className="rl-chips">
            <span className="rl-chip chip-high"><FiAlertTriangle />{risk.HIGH} High Risk</span>
            <span className="rl-chip chip-mod"><FiAlertCircle />{risk.MODERATE} Moderate</span>
            <span className="rl-chip chip-low"><FiCheckCircle />{risk.LOW} Reliable</span>
          </div>
        </div>
        <button className="rl-refresh-btn" onClick={handleRefresh} disabled={loading}>
          <FiRefreshCw className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {/* ── Global stats row ───────────────────────────── */}
      {stats && (
        <div className="rl-stats-row">
          <StatCard
            label="Total Sites Tracked"
            value={stats.totalSites.toLocaleString()}
            icon={<FiGlobe />}
            accentColor="#818cf8"
          />
          <StatCard
            label="Total Articles Scanned"
            value={stats.totalScans.toLocaleString()}
            icon={<HiOutlineChartBar />}
            accentColor="#38bdf8"
          />
          <StatCard
            label="Avg Fake Score"
            value={`${stats.avgFakeScore}%`}
            sub={`Max ${stats.maxFakeScore}%`}
            icon={<FiTrendingUp />}
            accentColor="#f87171"
          />
          <StatCard
            label="Fake Articles Found"
            value={stats.totalFake.toLocaleString()}
            sub={`${stats.totalReal.toLocaleString()} real`}
            icon={<FiAlertTriangle />}
            accentColor="#fbbf24"
          />
        </div>
      )}

      {/* ── Spotlights (top fake + most reliable) ─────── */}
      <div className="rl-spotlights">
        <div className="rl-spotlight-panel">
          <h3 className="rl-panel-title fake-title">
            <FiAlertTriangle /> Most Fake Sites
          </h3>
          {topFake.length === 0
            ? <p className="rl-panel-empty">No data yet</p>
            : topFake.map((s, i) => (
                <SpotlightItem key={s.domain} site={s} index={i} mode="fake" />
              ))}
        </div>
        <div className="rl-spotlight-panel">
          <h3 className="rl-panel-title reliable-title">
            <FiCheckCircle /> Most Reliable Sites
          </h3>
          {mostReliable.length === 0
            ? <p className="rl-panel-empty">No data yet</p>
            : mostReliable.map((s, i) => (
                <SpotlightItem key={s.domain} site={s} index={i} mode="reliable" />
              ))}
        </div>
      </div>

      {/* ── Controls ───────────────────────────────────── */}
      <div className="rl-controls">
        <span className="rl-total-count">
          {pagination.total > 0 && `${pagination.total} sites`}
        </span>
        <div className="rl-controls-right">
          <label className="rl-control-label" htmlFor="rl-sort">Sort by</label>
          <select
            id="rl-sort"
            className="rl-select"
            value={currentSort}
            onChange={handleSortChange}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────── */}
      {error && <div className="rl-error">{error}</div>}

      {/* ── Loading skeleton ───────────────────────────── */}
      {loading && sites.length === 0 && (
        <div className="rl-loading">
          <div className="rl-spinner" />
          <span>Loading rankings…</span>
        </div>
      )}

      {/* ── Leaderboard table ──────────────────────────── */}
      {!loading || sites.length > 0 ? (
        <div className="rl-table-wrap">
          <table className="rl-table">
            <thead>
              <tr>
                <th className="th-rank">Rank</th>
                <th className="th-domain">Domain</th>
                <th className="th-risk">Risk</th>
                <th className="th-bar">Fake / Real</th>
                <th className="th-score">Fake %</th>
                <th className="th-trust">Trust Score</th>
                <th className="th-scans">Scans</th>
              </tr>
            </thead>
            <AnimatePresence mode="wait">
              <motion.tbody
                key={`${currentSort}-${pagination.page}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {sites.map((site) => (
                  <motion.tr
                    key={site.domain}
                    className={`rl-row risk-row-${site.riskLevel.toLowerCase()}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <td className="td-rank">
                      <RankMedal rank={site.rank} />
                    </td>
                    <td className="td-domain">
                      <div className="rl-domain-cell">
                        <FiGlobe className="rl-globe-icon" />
                        <span className="rl-domain-name">{site.domain}</span>
                      </div>
                    </td>
                    <td className="td-risk">
                      <RiskBadge level={site.riskLevel} />
                    </td>
                    <td className="td-bar">
                      <ScoreBar fakeScore={site.fakeScore} />
                    </td>
                    <td className="td-score">
                      <span
                        className="rl-pct"
                        style={{
                          color: site.fakeScore >= 70
                            ? '#f87171'
                            : site.fakeScore >= 40
                            ? '#fbbf24'
                            : '#4ade80',
                        }}
                      >
                        {site.fakeScore.toFixed(1)}%
                      </span>
                    </td>
                    <td className="td-trust">
                      <span className="rl-trust">{site.trustScore.toFixed(1)}%</span>
                    </td>
                    <td className="td-scans">
                      <span className="rl-scans">{site.totalScans}</span>
                    </td>
                  </motion.tr>
                ))}
              </motion.tbody>
            </AnimatePresence>
          </table>

          {sites.length === 0 && !loading && (
            <div className="rl-empty">
              <HiOutlineChartBar size={40} />
              <h3>No sites ranked yet</h3>
              <p>Analyse some news articles to start building the leaderboard.</p>
            </div>
          )}
        </div>
      ) : null}

      {/* ── Pagination ─────────────────────────────────── */}
      {pagination.pages > 1 && (
        <div className="rl-pagination">
          <button
            className="rl-page-btn"
            disabled={pagination.page <= 1 || loading}
            onClick={() => loadPage(pagination.page - 1)}
          >
            <FiChevronLeft /> Prev
          </button>

          <div className="rl-page-nums">
            {Array.from({ length: pagination.pages }, (_, i) => i + 1)
              .filter((p) =>
                p === 1 ||
                p === pagination.pages ||
                Math.abs(p - pagination.page) <= 1
              )
              .reduce((acc, p, idx, arr) => {
                if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === '…' ? (
                  <span key={`ellipsis-${i}`} className="rl-ellipsis">…</span>
                ) : (
                  <button
                    key={p}
                    className={`rl-page-num ${p === pagination.page ? 'active' : ''}`}
                    onClick={() => loadPage(p)}
                    disabled={loading}
                  >
                    {p}
                  </button>
                )
              )}
          </div>

          <button
            className="rl-page-btn"
            disabled={pagination.page >= pagination.pages || loading}
            onClick={() => loadPage(pagination.page + 1)}
          >
            Next <FiChevronRight />
          </button>
        </div>
      )}
    </div>
  );
}
