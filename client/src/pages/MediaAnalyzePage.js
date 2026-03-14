import React, { useState, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import {
  FiVideo,
  FiUploadCloud,
  FiTrash2,
  FiCheckCircle,
  FiXCircle,
  FiAlertTriangle,
  FiInfo,
} from 'react-icons/fi';
import { analyzeVideo, clearCurrentAnalysis } from '../store/slices/analysisSlice';
import './MediaAnalyzePage.css';

const MediaAnalyzePage = () => {
  const dispatch = useDispatch();
  const currentAnalysis = useSelector((state) => state.analysis.currentAnalysis);
  const analyzing = useSelector((state) => state.analysis.analyzing);
  const error = useSelector((state) => state.analysis.error);

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (!selected) return;

    if (!selected.type.startsWith('video/')) {
      toast.error('Please select a valid video file.');
      return;
    }
    if (selected.size > 100 * 1024 * 1024) {
      toast.error('Video must be under 100 MB.');
      return;
    }

    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      const fakeEvent = { target: { files: [dropped] } };
      handleFileChange(fakeEvent);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.warning('Please select a file to analyze.');
      return;
    }

    const action = analyzeVideo({ file, title, context });

    const result = await dispatch(action);
    if (result.meta.requestStatus === 'fulfilled') {
      toast.success('Video analysis completed!');
    } else {
      toast.error(error || 'Failed to analyze video. Please try again.');
    }
  };

  const handleClear = () => {
    setFile(null);
    setPreview(null);
    setTitle('');
    setContext('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    dispatch(clearCurrentAnalysis());
  };

  const getVerdictIcon = (label) => {
    switch (label) {
      case 'AUTHENTIC':
      case 'REAL':
        return <FiCheckCircle />;
      case 'MANIPULATED':
      case 'FAKE':
        return <FiXCircle />;
      default:
        return <FiAlertTriangle />;
    }
  };

  const getVerdictClass = (label) => {
    switch (label) {
      case 'AUTHENTIC':
      case 'REAL':
        return 'real';
      case 'MANIPULATED':
      case 'FAKE':
        return 'fake';
      default:
        return 'uncertain';
    }
  };

  const getVerdictText = (label) => {
    switch (label) {
      case 'AUTHENTIC':
        return 'Likely Authentic';
      case 'MANIPULATED':
        return 'Likely Manipulated';
      case 'REAL':
        return 'Likely Real';
      case 'FAKE':
        return 'Likely Fake';
      default:
        return 'Uncertain';
    }
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };

  const pred = currentAnalysis?.prediction;
  return (
    <div className="media-analyze-page">
      <div className="container">
        <div className="analyze-header">
          <h1>Video Forensic Analysis</h1>
          <p>Upload a video to detect manipulation and deepfakes</p>
        </div>

        <div className="analyze-layout">
          {/* Upload Form */}
          <div className="analyze-form-card">
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Title (optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Name this video analysis..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">What is this video claimed to show? (improves accuracy)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. This video shows the 2024 earthquake aftermath in Turkey..."
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                />
              </div>

              <div
                className={`upload-zone ${file ? 'has-file' : ''}`}
                onClick={() => !file && fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                {!file ? (
                  <div className="upload-placeholder">
                    <FiUploadCloud className="upload-icon" />
                    <p className="upload-text">
                      Drop a video here or click to browse
                    </p>
                    <p className="upload-hint">
                      MP4, AVI, WebM, MOV, MKV — max 100 MB
                    </p>
                  </div>
                ) : (
                  <div className="file-preview">
                    {preview ? (
                      <video src={preview} className="preview-video" controls muted />
                    ) : null}
                    <div className="file-info">
                      <span className="file-name">{file.name}</span>
                      <span className="file-size">{formatBytes(file.size)}</span>
                    </div>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  hidden
                />
              </div>

              <div className="analyze-btn-row">
                <button
                  type="submit"
                  className="btn btn-primary btn-lg"
                  disabled={analyzing || !file}
                >
                  {analyzing ? (
                    <>
                      <span className="spinner" /> Analyzing...
                    </>
                  ) : (
                    <>
                      <FiVideo /> Analyze Video
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
                    Analyzing your video...
                  </div>
                  <div className="analyzing-sub">
                    Transcribing audio locally, then running Groq fact-check…
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
                  <div className={`result-verdict ${getVerdictClass(pred.label)}`}>
                    <div className={`verdict-icon ${getVerdictClass(pred.label)}`}>
                      {getVerdictIcon(pred.label)}
                    </div>
                    <div className={`verdict-label ${getVerdictClass(pred.label)}`}>
                      {getVerdictText(pred.label)}
                    </div>
                    <div className="verdict-confidence">
                      Confidence: {pred.confidence}%
                    </div>
                    <div className="confidence-bar">
                      <div
                        className={`confidence-fill ${getVerdictClass(pred.label)}`}
                        style={{ width: `${pred.confidence}%` }}
                      />
                    </div>
                  </div>

                  {/* Media-specific details */}
                  <div className="result-details">
                    {/* VIDEO RESULTS */}
                    {currentAnalysis?.analysisType === 'video' && (
                      <>
                        {/* Video Summary */}
                        {pred?.details?.videoSummary && (
                          <div className="detail-section">
                            <div className="detail-section-title">What the video shows</div>
                            <div className="ai-summary-item">
                              <span className="ai-summary-text">{pred.details.videoSummary}</span>
                            </div>
                          </div>
                        )}

                        {/* Reasoning */}
                        {pred?.details?.reasoning && (
                          <div className="detail-section">
                            <div className="detail-section-title">Verdict Reasoning</div>
                            <div className="ai-summary-item">
                              <span className="ai-summary-text">{pred.details.reasoning}</span>
                            </div>
                          </div>
                        )}

                        {/* Transcript */}
                        {pred?.details?.transcript && (
                          <div className="detail-section">
                            <div className="detail-section-title">
                              Audio Transcript
                              {pred.details.language && pred.details.language !== 'unknown' && (
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                                  [{pred.details.language.toUpperCase()}]
                                </span>
                              )}
                              {pred.details.duration > 0 && (
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                                  {pred.details.duration}s
                                </span>
                              )}
                            </div>
                            <div className="ai-summary-item">
                              <span className="ai-summary-text" style={{ whiteSpace: 'pre-wrap' }}>
                                {pred.details.transcript}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Models used */}
                        {pred?.details?.models && Object.keys(pred.details.models).length > 0 && (
                          <div className="ai-summary-item">
                            <span className="ai-summary-label">Powered by:</span>
                            <span className="ai-summary-text ai-summary-source">
                              {Object.values(pred.details.models).join(' + ')}
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    {/* Info note */}
                    <div className="media-info-note">
                      <FiInfo />
                      <span>
                        Audio transcribed locally with Whisper, then fact-checked with Groq (2 API calls total).
                      </span>
                    </div>
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
                    <FiVideo />
                  </div>
                  <h3>No Analysis Yet</h3>
                  <p>
                    Upload a video and click Analyze to check for manipulation.
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

export default MediaAnalyzePage;
