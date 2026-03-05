import React, { useState, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import {
  FiImage,
  FiVideo,
  FiUploadCloud,
  FiTrash2,
  FiCheckCircle,
  FiXCircle,
  FiAlertTriangle,
  FiInfo,
} from 'react-icons/fi';
import { analyzeImage, analyzeVideo, clearCurrentAnalysis } from '../store/slices/analysisSlice';
import './MediaAnalyzePage.css';

const MediaAnalyzePage = () => {
  const dispatch = useDispatch();
  const { currentAnalysis, analyzing, error } = useSelector(
    (state) => state.analysis
  );

  const [mode, setMode] = useState('image'); // 'image' or 'video'
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [title, setTitle] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (!selected) return;

    // Validate type
    if (mode === 'image') {
      if (!selected.type.startsWith('image/')) {
        toast.error('Please select a valid image file.');
        return;
      }
      if (selected.size > 20 * 1024 * 1024) {
        toast.error('Image must be under 20 MB.');
        return;
      }
    } else {
      if (!selected.type.startsWith('video/')) {
        toast.error('Please select a valid video file.');
        return;
      }
      if (selected.size > 100 * 1024 * 1024) {
        toast.error('Video must be under 100 MB.');
        return;
      }
    }

    setFile(selected);

    // Create preview
    if (mode === 'image') {
      const reader = new FileReader();
      reader.onload = (ev) => setPreview(ev.target.result);
      reader.readAsDataURL(selected);
    } else {
      setPreview(URL.createObjectURL(selected));
    }
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

    const action = mode === 'image'
      ? analyzeImage({ file, title })
      : analyzeVideo({ file, title });

    const result = await dispatch(action);
    if (result.meta.requestStatus === 'fulfilled') {
      toast.success(`${mode === 'image' ? 'Image' : 'Video'} analysis completed!`);
    } else {
      toast.error(error || `Failed to analyze ${mode}. Please try again.`);
    }
  };

  const handleClear = () => {
    setFile(null);
    setPreview(null);
    setTitle('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    dispatch(clearCurrentAnalysis());
  };

  const switchMode = (newMode) => {
    if (newMode !== mode) {
      handleClear();
      setMode(newMode);
    }
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
  const mediaDetails = pred?.details?.mediaDetails;

  return (
    <div className="media-analyze-page">
      <div className="container">
        <div className="analyze-header">
          <h1>Media Forensic Analysis</h1>
          <p>Upload an image or video to detect manipulation and deepfakes</p>
        </div>

        {/* Mode Switcher */}
        <div className="mode-switcher">
          <button
            className={`mode-btn ${mode === 'image' ? 'active' : ''}`}
            onClick={() => switchMode('image')}
          >
            <FiImage /> Image Analysis
          </button>
          <button
            className={`mode-btn ${mode === 'video' ? 'active' : ''}`}
            onClick={() => switchMode('video')}
          >
            <FiVideo /> Video Analysis
          </button>
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
                  placeholder={`Name this ${mode} analysis...`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
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
                      {mode === 'image'
                        ? 'Drop an image here or click to browse'
                        : 'Drop a video here or click to browse'}
                    </p>
                    <p className="upload-hint">
                      {mode === 'image'
                        ? 'JPEG, PNG, WebP, BMP — max 20 MB'
                        : 'MP4, AVI, WebM, MOV, MKV — max 100 MB'}
                    </p>
                  </div>
                ) : (
                  <div className="file-preview">
                    {mode === 'image' && preview ? (
                      <img src={preview} alt="Preview" className="preview-img" />
                    ) : mode === 'video' && preview ? (
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
                  accept={mode === 'image' ? 'image/*' : 'video/*'}
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
                      {mode === 'image' ? <FiImage /> : <FiVideo />} Analyze {mode === 'image' ? 'Image' : 'Video'}
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
                    Analyzing your {mode}...
                  </div>
                  <div className="analyzing-sub">
                    {mode === 'image'
                      ? 'Running ELA, metadata, and pixel analysis'
                      : 'Extracting frames and running forensic analysis'}
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
                    {/* IMAGE RESULTS */}
                    {currentAnalysis?.analysisType === 'image' && mediaDetails && (
                      <>
                        {/* ELA Section */}
                        <div className="detail-section">
                          <div className="detail-section-title">
                            Error Level Analysis (ELA)
                          </div>
                          <div className="detail-grid">
                            <div className="detail-item">
                              <span className="detail-item-label">Mean Error</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.error_level_analysis?.mean_error}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Max Error</span>
                              <span className={`detail-item-value ${mediaDetails.error_level_analysis?.max_error > 30 ? 'negative' : 'neutral'}`}>
                                {mediaDetails.error_level_analysis?.max_error}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Suspicious Pixels</span>
                              <span className={`detail-item-value ${mediaDetails.error_level_analysis?.suspicious_pixel_ratio > 0.02 ? 'negative' : 'positive'}`}>
                                {((mediaDetails.error_level_analysis?.suspicious_pixel_ratio || 0) * 100).toFixed(2)}%
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Max Channel Diff</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.error_level_analysis?.max_channel_diff}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Metadata Section */}
                        <div className="detail-section">
                          <div className="detail-section-title">
                            Metadata Analysis
                          </div>
                          <div className="detail-grid">
                            <div className="detail-item">
                              <span className="detail-item-label">EXIF Data</span>
                              <span className={`indicator-tag ${mediaDetails.metadata?.has_exif ? 'clear' : 'detected'}`}>
                                {mediaDetails.metadata?.has_exif ? 'Present' : 'Missing'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Edit Software</span>
                              <span className={`indicator-tag ${mediaDetails.metadata?.has_edit_software ? 'detected' : 'clear'}`}>
                                {mediaDetails.metadata?.has_edit_software
                                  ? mediaDetails.metadata?.editing_software || 'Detected'
                                  : 'None'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Format</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.metadata?.format}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Dimensions</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.metadata?.size?.width}×{mediaDetails.metadata?.size?.height}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Pixel Stats */}
                        <div className="detail-section">
                          <div className="detail-section-title">
                            Pixel Statistics
                          </div>
                          <div className="detail-grid">
                            <div className="detail-item">
                              <span className="detail-item-label">Uniformity</span>
                              <span className={`indicator-tag ${mediaDetails.pixel_statistics?.is_overly_uniform ? 'detected' : 'clear'}`}>
                                {mediaDetails.pixel_statistics?.is_overly_uniform ? 'Suspicious' : 'Normal'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Noise Level</span>
                              <span className={`indicator-tag ${mediaDetails.pixel_statistics?.low_noise_flag ? 'detected' : 'clear'}`}>
                                {mediaDetails.pixel_statistics?.low_noise_flag ? 'AI-like' : 'Natural'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Noise Variance</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.pixel_statistics?.noise_variance}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Overall Std</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.pixel_statistics?.overall_std}
                              </span>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* VIDEO RESULTS */}
                    {currentAnalysis?.analysisType === 'video' && mediaDetails && (
                      <>
                        {/* Video Info */}
                        <div className="detail-section">
                          <div className="detail-section-title">
                            Video Information
                          </div>
                          <div className="detail-grid">
                            <div className="detail-item">
                              <span className="detail-item-label">Duration</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.video_info?.duration_seconds}s
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">FPS</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.video_info?.fps}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Resolution</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.video_info?.resolution?.width}×{mediaDetails.video_info?.resolution?.height}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Frames Analyzed</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.frames_analyzed}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Frame Consistency */}
                        <div className="detail-section">
                          <div className="detail-section-title">
                            Frame Consistency
                          </div>
                          <div className="detail-grid">
                            <div className="detail-item">
                              <span className="detail-item-label">Consistency</span>
                              <span className={`indicator-tag ${mediaDetails.frame_consistency?.consistent ? 'clear' : 'detected'}`}>
                                {mediaDetails.frame_consistency?.consistent ? 'Consistent' : 'Anomalies Found'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Anomalies</span>
                              <span className={`detail-item-value ${mediaDetails.frame_consistency?.anomaly_count > 0 ? 'negative' : 'positive'}`}>
                                {mediaDetails.frame_consistency?.anomaly_count}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Mean Frame Diff</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.frame_consistency?.mean_frame_diff}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Avg ELA Score</span>
                              <span className={`detail-item-value ${mediaDetails.avg_ela_score > 0.03 ? 'negative' : 'positive'}`}>
                                {((mediaDetails.avg_ela_score || 0) * 100).toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Noise Analysis */}
                        <div className="detail-section">
                          <div className="detail-section-title">
                            Noise Analysis
                          </div>
                          <div className="detail-grid">
                            <div className="detail-item">
                              <span className="detail-item-label">Noise Profile</span>
                              <span className={`indicator-tag ${mediaDetails.noise_analysis?.inconsistent_noise ? 'detected' : 'clear'}`}>
                                {mediaDetails.noise_analysis?.inconsistent_noise ? 'Inconsistent' : 'Consistent'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Mean Noise</span>
                              <span className="detail-item-value neutral">
                                {mediaDetails.noise_analysis?.mean_noise}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Noise Variation</span>
                              <span className={`detail-item-value ${mediaDetails.noise_analysis?.noise_variation > 0.5 ? 'negative' : 'neutral'}`}>
                                {mediaDetails.noise_analysis?.noise_variation}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-item-label">Manipulation Score</span>
                              <span className={`detail-item-value ${mediaDetails.manipulation_score > 40 ? 'negative' : mediaDetails.manipulation_score > 20 ? 'neutral' : 'positive'}`}>
                                {mediaDetails.manipulation_score}/100
                              </span>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Info note */}
                    <div className="media-info-note">
                      <FiInfo />
                      <span>
                        {currentAnalysis?.analysisType === 'image'
                          ? 'Analysis uses Error Level Analysis (ELA), metadata inspection, and pixel statistics to detect manipulations.'
                          : 'Analysis extracts frames and checks temporal consistency, noise profiles, and per-frame ELA.'}
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
                    {mode === 'image' ? <FiImage /> : <FiVideo />}
                  </div>
                  <h3>No Analysis Yet</h3>
                  <p>
                    Upload {mode === 'image' ? 'an image' : 'a video'} and click Analyze to check for manipulation.
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
