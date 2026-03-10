import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { FiSearch, FiArrowRight, FiExternalLink, FiGlobe, FiMonitor } from 'react-icons/fi';
import { fetchHistory } from '../store/slices/analysisSlice';
import './HistoryPage.css';

const VERDICT_COLOR = {
  REAL:        { bg: 'rgba(74,222,128,0.12)',  color: '#4ade80', border: 'rgba(74,222,128,0.3)'  },
  FAKE:        { bg: 'rgba(248,113,113,0.12)', color: '#f87171', border: 'rgba(248,113,113,0.3)' },
  UNCERTAIN:   { bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24', border: 'rgba(251,191,36,0.3)'  },
  AUTHENTIC:   { bg: 'rgba(74,222,128,0.12)',  color: '#4ade80', border: 'rgba(74,222,128,0.3)'  },
  MANIPULATED: { bg: 'rgba(248,113,113,0.12)', color: '#f87171', border: 'rgba(248,113,113,0.3)' },
};

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function VerdictBadge({ label }) {
  const s = VERDICT_COLOR[label] || VERDICT_COLOR.UNCERTAIN;
  return (
    <span className="hist-verdict-badge" style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {label}
    </span>
  );
}

const HistoryPage = () => {
  const dispatch = useDispatch();
  const history = useSelector((s) => s.analysis.history);
  const pagination = useSelector((s) => s.analysis.pagination);
  const loading = useSelector((s) => s.analysis.loading);
  const error = useSelector((s) => s.analysis.error);
  const [filter, setFilter] = useState('');
  const [page, setPage]     = useState(1);

  useEffect(() => {
    dispatch(fetchHistory({ page, limit: 10, label: filter || undefined }));
  }, [dispatch, page, filter]);

  const handleFilter = (label) => {
    setFilter(label === filter ? '' : label);
    setPage(1);
  };

  return (
    <div className="history-page">
      <div className="container">

        {/* ── Header ── */}
        <div className="history-header">
          <div>
            <h1 className="history-title">Analysis History</h1>
            {pagination && (
              <p className="history-subtitle">{pagination.total} scan{pagination.total !== 1 ? 's' : ''} recorded</p>
            )}
          </div>
          <div className="history-filters">
            {['REAL', 'FAKE', 'UNCERTAIN'].map((label) => {
              const s = VERDICT_COLOR[label];
              return (
                <button
                  key={label}
                  className={`filter-btn${filter === label ? ' active' : ''}`}
                  style={filter === label ? { background: s.bg, color: s.color, borderColor: s.border } : {}}
                  onClick={() => handleFilter(label)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Error ── */}
        {error && !loading && (
          <div className="history-error">
            ⚠ Could not load history — {error}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="history-loading">
            <div className="hist-spinner" />
            <span>Loading history…</span>
          </div>
        )}

        {/* ── List ── */}
        {!loading && history.length > 0 && (
          <>
            <div className="history-list">
              <AnimatePresence mode="popLayout">
                {history.map((item, i) => {
                  const isExtension = !item.user;
                  return (
                    <motion.div
                      key={item._id}
                      className="history-card"
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.18, delay: i < 10 ? i * 0.03 : 0 }}
                    >
                      <div className="hist-card-left">
                        <div className="hist-title">{item.title || 'Untitled Analysis'}</div>
                        <div className="hist-meta">
                          <span className={`hist-source-tag ${isExtension ? 'tag-ext' : 'tag-web'}`}>
                            {isExtension ? <><FiGlobe size={10}/> Extension</> : <><FiMonitor size={10}/> Web App</>}
                          </span>
                          <span>{formatDate(item.createdAt)}</span>
                          {item.sourceUrl && (
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hist-url-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <FiExternalLink size={11}/> Source
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="hist-card-right">
                        <VerdictBadge label={item.prediction.label} />
                        <span className="hist-conf">{item.prediction.confidence}%</span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {pagination && pagination.pages > 1 && (
              <div className="pagination">
                <button
                  className="pagination-btn"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  ← Previous
                </button>
                <span className="pagination-info">
                  Page {pagination.page} of {pagination.pages}
                </span>
                <button
                  className="pagination-btn"
                  disabled={page >= pagination.pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Empty ── */}
        {!loading && !error && history.length === 0 && (
          <div className="history-empty">
            <FiSearch size={36} opacity={0.3} />
            <h3>No Analyses Found</h3>
            <p>
              {filter
                ? `No ${filter} results. Try a different filter.`
                : 'Analyses appear here after you scan articles via the web app or TruthLens extension.'}
            </p>
            <Link to="/analyze" className="btn btn-primary" style={{ marginTop: '1.25rem' }}>
              Analyze News <FiArrowRight />
            </Link>
          </div>
        )}

      </div>
    </div>
  );
};

export default HistoryPage;
