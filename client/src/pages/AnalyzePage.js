import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import {
  FiSearch,
  FiTrash2,
  FiCheckCircle,
  FiXCircle,
  FiAlertTriangle,
} from 'react-icons/fi';
import { analyzeNews, clearCurrentAnalysis } from '../store/slices/analysisSlice';
import './AnalyzePage.css';

const AnalyzePage = () => {
  const dispatch = useDispatch();
  const { currentAnalysis, analyzing, error } = useSelector(
    (state) => state.analysis
  );

  const [formData, setFormData] = useState({
    title: '',
    content: '',
    sourceUrl: '',
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.content.trim().length < 20) {
      toast.warning('Please enter at least 20 characters of news content.');
      return;
    }
    const result = await dispatch(analyzeNews(formData));
    if (result.meta.requestStatus === 'fulfilled') {
      toast.success('Analysis completed successfully!');
    } else {
      toast.error(error || 'Failed to analyze. Please try again.');
    }
  };

  const handleClear = () => {
    setFormData({ title: '', content: '', sourceUrl: '' });
    dispatch(clearCurrentAnalysis());
  };

  const getVerdictIcon = (label) => {
    switch (label) {
      case 'REAL':
        return <FiCheckCircle />;
      case 'FAKE':
        return <FiXCircle />;
      default:
        return <FiAlertTriangle />;
    }
  };

  const pred = currentAnalysis?.prediction;

  return (
    <div className="analyze-page">
      <div className="container">
        <div className="analyze-header">
          <h1>Analyze News Article</h1>
          <p>Paste your news content below for an AI-powered credibility check</p>
        </div>

        <div className="analyze-layout">
          {/* Form */}
          <div className="analyze-form-card">
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Headline / Title (optional)</label>
                <input
                  type="text"
                  name="title"
                  className="form-input"
                  placeholder="Enter the news headline..."
                  value={formData.title}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label className="form-label">News Content *</label>
                <textarea
                  name="content"
                  className="form-textarea"
                  placeholder="Paste the full news article text here for the most accurate analysis..."
                  value={formData.content}
                  onChange={handleChange}
                  rows={10}
                />
                <div className="char-count">
                  {formData.content.length} characters
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Source URL (optional)</label>
                <input
                  type="url"
                  name="sourceUrl"
                  className="form-input"
                  placeholder="https://example.com/news-article"
                  value={formData.sourceUrl}
                  onChange={handleChange}
                />
              </div>

              <div className="analyze-btn-row">
                <button
                  type="submit"
                  className="btn btn-primary btn-lg"
                  disabled={analyzing || formData.content.trim().length < 20}
                >
                  {analyzing ? (
                    <>
                      <span className="spinner" /> Analyzing...
                    </>
                  ) : (
                    <>
                      <FiSearch /> Analyze
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-lg"
                  onClick={handleClear}
                >
                  <FiTrash2 /> Clear
                </button>
              </div>
            </form>
          </div>

          {/* Results */}
          <div className="result-panel">
            <AnimatePresence mode="wait">
              {analyzing ? (
                <motion.div
                  key="loading"
                  className="analyzing-overlay"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="analyzing-spinner" />
                  <div className="analyzing-text">
                    Analyzing your article...
                  </div>
                  <div className="analyzing-sub">
                    Running ML models and NLP analysis
                  </div>
                </motion.div>
              ) : pred ? (
                <motion.div
                  key="result"
                  className="result-card"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  {/* Verdict */}
                  <div
                    className={`result-verdict ${pred.label.toLowerCase()}`}
                  >
                    <div
                      className={`verdict-icon ${pred.label.toLowerCase()}`}
                    >
                      {getVerdictIcon(pred.label)}
                    </div>
                    <div
                      className={`verdict-label ${pred.label.toLowerCase()}`}
                    >
                      {pred.label === 'REAL'
                        ? 'Likely Real'
                        : pred.label === 'FAKE'
                        ? 'Likely Fake'
                        : 'Uncertain'}
                    </div>
                    <div className="verdict-confidence">
                      Confidence: {pred.confidence}%
                    </div>
                    <div className="confidence-bar">
                      <div
                        className={`confidence-fill ${pred.label.toLowerCase()}`}
                        style={{ width: `${pred.confidence}%` }}
                      />
                    </div>
                  </div>

                  {/* Details */}
                  <div className="result-details">
                    {/* ── HuggingFace AI result ── */}
                    {pred.details?.source === 'huggingface' ? (
                      <>
                        <div className="detail-section">
                          <div className="detail-section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            AI Verification
                            <span style={{ fontSize: '11px', background: '#ff6b35', color: '#fff', borderRadius: '4px', padding: '1px 7px', fontWeight: 600 }}>HuggingFace AI</span>
                          </div>
                          {pred.details?.modelScores?.length > 0 && (
                            <div className="detail-grid" style={{ marginTop: '10px' }}>
                              {pred.details.modelScores.map((s) => (
                                <div className="detail-item" key={s.label}>
                                  <span className="detail-item-label">{s.label}</span>
                                  <span className={`detail-item-value ${s.score >= 50 ? 'positive' : 'neutral'}`}>
                                    {s.score}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : pred.details?.source === 'gemini' ? (
                      /* ── Gemini result ── */
                      <>
                        <div className="detail-section">
                          <div className="detail-section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            AI Verification
                            <span style={{ fontSize: '11px', background: '#4f8ef7', color: '#fff', borderRadius: '4px', padding: '1px 7px', fontWeight: 600 }}>Gemini AI</span>
                          </div>
                          {pred.details?.reasoning && (
                            <div className="detail-item" style={{ display: 'block', padding: '10px 0' }}>
                              <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--text-secondary, #aaa)' }}>
                                {pred.details.reasoning}
                              </p>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      /* ── NLP fallback result ── */
                      <>
                        <div className="detail-section">
                          <div className="detail-section-title">
                            Credibility Indicators
                          </div>
                          <div className="detail-grid">
                            <div className="detail-item">
                              <span className="detail-item-label">Clickbait</span>
                              <span
                                className={`indicator-tag ${
                                  pred.details?.credibilityIndicators?.hasClickbait
                                    ? 'detected'
                                    : 'clear'
                                }`}
                              >
                                {pred.details?.credibilityIndicators?.hasClickbait
                                  ? 'Detected'
                                  : 'Clear'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Emotional</span>
                              <span
                                className={`indicator-tag ${
                                  pred.details?.credibilityIndicators
                                    ?.hasEmotionalLanguage
                                    ? 'detected'
                                    : 'clear'
                                }`}
                              >
                                {pred.details?.credibilityIndicators
                                  ?.hasEmotionalLanguage
                                  ? 'Detected'
                                  : 'Clear'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Sources Cited</span>
                              <span
                                className={`indicator-tag ${
                                  pred.details?.credibilityIndicators
                                    ?.hasSourceAttribution
                                    ? 'clear'
                                    : 'detected'
                                }`}
                              >
                                {pred.details?.credibilityIndicators
                                  ?.hasSourceAttribution
                                  ? 'Yes'
                                  : 'No'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Statistics</span>
                              <span
                                className={`indicator-tag ${
                                  pred.details?.credibilityIndicators
                                    ?.hasStatisticalClaims
                                    ? 'clear'
                                    : 'detected'
                                }`}
                              >
                                {pred.details?.credibilityIndicators
                                  ?.hasStatisticalClaims
                                  ? 'Present'
                                  : 'None'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="detail-section">
                          <div className="detail-section-title">
                            Text Analysis
                          </div>
                          <div className="detail-grid">
                            <div className="detail-item">
                              <span className="detail-item-label">Sentiment</span>
                              <span
                                className={`detail-item-value ${
                                  (pred.details?.sentimentScore || 0) > 0
                                    ? 'positive'
                                    : (pred.details?.sentimentScore || 0) < 0
                                    ? 'negative'
                                    : 'neutral'
                                }`}
                              >
                                {pred.details?.sentimentScore || 0}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Subjectivity</span>
                              <span className="detail-item-value neutral">
                                {(
                                  (pred.details?.subjectivityScore || 0) * 100
                                ).toFixed(1)}
                                %
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Readability</span>
                              <span className="detail-item-value neutral">
                                {pred.details?.credibilityIndicators
                                  ?.readabilityScore || 0}
                              </span>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="placeholder"
                  className="result-placeholder"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <div className="result-placeholder-icon">
                    <FiSearch />
                  </div>
                  <h3>No Analysis Yet</h3>
                  <p>
                    Enter a news article on the left and click Analyze to get
                    started.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyzePage;
