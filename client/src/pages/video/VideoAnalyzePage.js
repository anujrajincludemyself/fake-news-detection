import React, { useState, useRef } from 'react';
import { toast } from 'react-toastify';
import {
  FiVideo,
  FiUploadCloud,
  FiTrash2,
  FiCheckCircle,
  FiXCircle,
  FiAlertTriangle,
  FiChevronDown,
  FiChevronUp,
  FiFilm,
  FiLoader,
} from 'react-icons/fi';
import api from '../../services/api';
import './VideoAnalyzePage.css';

const VideoAnalyzePage = () => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [framesOpen, setFramesOpen] = useState(false);
  const fileInputRef = useRef(null);

  // ── File selection ────────────────────────────────────────────────────────
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
    setResult(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileChange({ target: { files: [dropped] } });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleClear = () => {
    setFile(null);
    setPreview(null);
    setTitle('');
    setContext('');
    setResult(null);
    setFramesOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.warning('Please select a video file first.');
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (title.trim()) formData.append('title', title.trim());
      if (context.trim()) formData.append('context', context.trim());

      const response = await api.post('/video/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000, // 2 min — frame extraction + multiple Groq calls
      });

      if (response.data?.success) {
        setResult(response.data.data);
        toast.success('Video analysis complete!');
      } else {
        toast.error(response.data?.message || 'Analysis failed.');
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'An error occurred.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Verdict helpers ───────────────────────────────────────────────────────
  const verdictMeta = (label) => {
    switch (label) {
      case 'REAL':
        return { icon: <FiCheckCircle />, cls: 'verdict-real', text: 'Likely Real / Consistent' };
      case 'FAKE':
        return { icon: <FiXCircle />, cls: 'verdict-fake', text: 'Likely Fake / Inconsistent' };
      default:
        return { icon: <FiAlertTriangle />, cls: 'verdict-uncertain', text: 'Uncertain' };
    }
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };

  return (
    <div className="vap-page">
      <div className="container">

        {/* Header */}
        <div className="vap-header">
          <div className="vap-header-icon"><FiFilm /></div>
          <h1>Video Fact Checker</h1>
          <p>
            Upload a video and describe what it's claimed to show. Our AI will extract
            frames, describe the content, and verify the claim using Groq.
          </p>
        </div>

        <div className="vap-layout">

          {/* ── Upload Form ── */}
          <div className="vap-card">
            <h2 className="vap-card-title">Upload &amp; Context</h2>

            <form onSubmit={handleSubmit}>
              {/* Drop zone */}
              <div
                className={`vap-dropzone ${file ? 'has-file' : ''}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => !file && fileInputRef.current?.click()}
              >
                {file ? (
                  <div className="vap-preview">
                    <video src={preview} controls className="vap-video-preview" />
                    <div className="vap-file-info">
                      <span className="vap-filename">{file.name}</span>
                      <span className="vap-filesize">{formatBytes(file.size)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="vap-dropzone-inner">
                    <FiUploadCloud className="vap-upload-icon" />
                    <p>Drag &amp; drop a video here, or <span className="vap-link">browse</span></p>
                    <small>MP4, WebM, MOV, AVI, MKV — max 100 MB</small>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="vap-file-input"
                />
              </div>

              {/* Title */}
              <div className="vap-field">
                <label className="vap-label">Title <span className="optional">(optional)</span></label>
                <input
                  type="text"
                  className="vap-input"
                  placeholder="e.g. News clip about flood relief"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={loading}
                />
              </div>

              {/* Context / Claim */}
              <div className="vap-field">
                <label className="vap-label">Context / Claim</label>
                <textarea
                  className="vap-textarea"
                  placeholder="Describe what this video is claimed to show, e.g. 'This video shows the 2024 earthquake aftermath in Turkey'"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={3}
                  disabled={loading}
                />
                <small className="vap-hint">
                  The more context you provide, the more accurate the fact-check.
                </small>
              </div>

              {/* Actions */}
              <div className="vap-actions">
                <button
                  type="submit"
                  className="vap-btn-primary"
                  disabled={!file || loading}
                >
                  {loading ? (
                    <>
                      <FiLoader className="spin" /> Analysing…
                    </>
                  ) : (
                    <>
                      <FiVideo /> Analyse Video
                    </>
                  )}
                </button>
                {(file || result) && (
                  <button
                    type="button"
                    className="vap-btn-ghost"
                    onClick={handleClear}
                    disabled={loading}
                  >
                    <FiTrash2 /> Clear
                  </button>
                )}
              </div>
            </form>

            {/* Loading indicator */}
            {loading && (
              <div className="vap-loading-info">
                <div className="vap-progress-bar" />
                <p>Extracting frames, transcribing audio locally, then running Groq fact-check — this may take up to 90 seconds…</p>
              </div>
            )}
          </div>

          {/* ── Results ── */}
          {result && (
            <div className="vap-results">

              {/* Verdict banner */}
              {(() => {
                const meta = verdictMeta(result.verdict?.label);
                return (
                  <div className={`vap-verdict-banner ${meta.cls}`}>
                    <div className="vap-verdict-icon">{meta.icon}</div>
                    <div className="vap-verdict-body">
                      <div className="vap-verdict-label">{meta.text}</div>
                      <div className="vap-verdict-confidence">
                        Confidence: {result.verdict?.confidence ?? '—'}%
                      </div>
                      {result.verdict?.reasoning && (
                        <div className="vap-verdict-reasoning">{result.verdict.reasoning}</div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Video summary */}
              <div className="vap-card vap-summary-card">
                <h3 className="vap-section-title">What the video shows</h3>
                <p className="vap-summary-text">{result.videoSummary || 'No summary available.'}</p>
              </div>

              {/* Transcript (collapsible) */}
              {result.transcript && (
                <div className="vap-card vap-frames-card">
                  <button
                    className="vap-frames-toggle"
                    onClick={() => setFramesOpen((o) => !o)}
                  >
                    <span>
                      Audio transcript
                      {result.language && result.language !== 'unknown' && (
                        <span className="vap-frame-badge" style={{ marginLeft: '0.6rem' }}>
                          {result.language.toUpperCase()}
                        </span>
                      )}
                      {result.duration > 0 && (
                        <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.5rem', fontSize: '0.85rem' }}>
                          {result.duration}s
                        </span>
                      )}
                    </span>
                    {framesOpen ? <FiChevronUp /> : <FiChevronDown />}
                  </button>
                  {framesOpen && (
                    <div className="vap-frames-list">
                      {result.segments?.length > 0
                        ? result.segments.map((s, i) => (
                            <div key={i} className="vap-frame-item">
                              <span className="vap-frame-badge">{s.start}s – {s.end}s</span>
                              <p>{s.text}</p>
                            </div>
                          ))
                        : <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{result.transcript}</p>
                      }
                    </div>
                  )}
                </div>
              )}

              {/* Raw JSON toggle */}
              <details className="vap-json-toggle">
                <summary>View raw JSON output</summary>
                <pre className="vap-json-pre">{JSON.stringify(result, null, 2)}</pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoAnalyzePage;
