import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HiShieldCheck,
  HiLightningBolt,
  HiChartBar,
  HiDatabase,
  HiPhotograph,
  HiFilm,
} from 'react-icons/hi';
import { FiArrowRight, FiSearch, FiCpu, FiCheckCircle, FiBarChart2, FiX, FiAlertCircle } from 'react-icons/fi';
import { loginUser, registerUser, clearError } from '../store/slices/authSlice';
import FeatureCard from '../components/ui/FeatureCard';
import StepCard from '../components/ui/StepCard';
import SectionHeader from '../components/ui/SectionHeader';
import './HomePage.css';

const heroFade = {
  hidden: { opacity: 0, y: 32 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.6, ease: [0.4, 0, 0.2, 1] },
  }),
};

const features = [
  { icon: <HiLightningBolt />, color: 'blue',   title: 'Real-Time Analysis',   desc: 'Instant credibility scores on any article using our advanced AI pipeline.' },
  { icon: <HiShieldCheck />,   color: 'purple', title: 'ML-Powered Detection', desc: 'Ensemble of Logistic Regression, Random Forest, and Gradient Boosting models.' },
  { icon: <HiPhotograph />,    color: 'pink',   title: 'Image Forensics',      desc: 'Detect manipulated images via ELA, metadata analysis, and pixel-level statistics.' },
  { icon: <HiFilm />,          color: 'teal',   title: 'Video Analysis',       desc: 'Analyze videos for frame consistency, noise anomalies, and temporal manipulation.' },
  { icon: <HiChartBar />,      color: 'amber',  title: 'Detailed Breakdown',   desc: 'Sentiment, subjectivity, clickbait detection, and credibility indicators.' },
  { icon: <HiDatabase />,      color: 'green',  title: 'History Tracking',     desc: 'Save and review all previous analyses with your personal dashboard.' },
];

const steps = [
  { icon: <FiSearch />,      title: 'Paste Article',  desc: 'Paste any news article text or headline you want to verify.' },
  { icon: <FiCpu />,         title: 'AI Processing',  desc: 'Our ML models and NLP engine analyze the content in real time.' },
  { icon: <FiCheckCircle />, title: 'Get Verdict',    desc: 'Receive a REAL, FAKE, or UNCERTAIN verdict with confidence score.' },
  { icon: <FiBarChart2 />,   title: 'Review Details', desc: 'Explore detailed credibility indicators and visual metrics.' },
];

const stats = [
  { number: '95%+', label: 'Model Accuracy' },
  { number: '<2s',  label: 'Analysis Time' },
  { number: '50K+', label: 'Training Samples' },
];

const HomePage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);
  const loading = useSelector((state) => state.auth.loading);
  const authError = useSelector((state) => state.auth.error);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [postLoginRoute, setPostLoginRoute] = useState(null);

  // Login form state
  const [loginData, setLoginData] = useState({ email: '', password: '' });
  // Register form state
  const [registerData, setRegisterData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (isAuthenticated && showAuthModal) {
      setShowAuthModal(false);
      dispatch(clearError());
      if (postLoginRoute) navigate(postLoginRoute);
    }
  }, [isAuthenticated, showAuthModal, postLoginRoute, navigate, dispatch]);

  const openAuthModal = (mode = 'login', route = null) => {
    dispatch(clearError());
    setLocalError('');
    setAuthMode(mode);
    setPostLoginRoute(route);
    setShowAuthModal(true);
  };

  const closeAuthModal = () => {
    setShowAuthModal(false);
    dispatch(clearError());
    setLocalError('');
    setLoginData({ email: '', password: '' });
    setRegisterData({ name: '', email: '', password: '', confirmPassword: '' });
  };

  const handleProtectedNav = (route) => {
    if (isAuthenticated) {
      navigate(route);
    } else {
      openAuthModal('login', route);
    }
  };

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    dispatch(loginUser(loginData));
  };

  const handleRegisterSubmit = (e) => {
    e.preventDefault();
    if (registerData.password !== registerData.confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }
    const { confirmPassword, ...data } = registerData;
    dispatch(registerUser(data));
  };

  const displayError = localError || authError;

  return (
    <div className="home-page">

      {/* ── Auth Modal ── */}
      <AnimatePresence>
        {showAuthModal && (
          <motion.div
            className="auth-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.target === e.currentTarget && closeAuthModal()}
          >
            <motion.div
              className="auth-modal-card"
              initial={{ opacity: 0, y: 32, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            >
              <button className="auth-modal-close" onClick={closeAuthModal} aria-label="Close">
                <FiX />
              </button>

              <div className="auth-header">
                <div className="auth-logo"><HiShieldCheck /></div>
                {authMode === 'login' ? (
                  <>
                    <h2>Welcome Back</h2>
                    <p>Sign in to your TASDEEQ account</p>
                  </>
                ) : (
                  <>
                    <h2>Create Account</h2>
                    <p>Join TASDEEQ and fight misinformation</p>
                  </>
                )}
              </div>

              {displayError && (
                <div className="auth-error">
                  <FiAlertCircle /> {displayError}
                </div>
              )}

              {authMode === 'login' ? (
                <form onSubmit={handleLoginSubmit}>
                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input
                      type="email"
                      className="form-input"
                      placeholder="you@example.com"
                      value={loginData.email}
                      onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Enter your password"
                      value={loginData.password}
                      onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                      required
                      minLength={6}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
                    {loading ? <><span className="spinner" /> Signing In...</> : 'Sign In'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRegisterSubmit}>
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="John Doe"
                      value={registerData.name}
                      onChange={(e) => { setLocalError(''); setRegisterData({ ...registerData, name: e.target.value }); }}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input
                      type="email"
                      className="form-input"
                      placeholder="you@example.com"
                      value={registerData.email}
                      onChange={(e) => { setLocalError(''); setRegisterData({ ...registerData, email: e.target.value }); }}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="At least 6 characters"
                      value={registerData.password}
                      onChange={(e) => { setLocalError(''); setRegisterData({ ...registerData, password: e.target.value }); }}
                      required
                      minLength={6}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Confirm Password</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Confirm your password"
                      value={registerData.confirmPassword}
                      onChange={(e) => { setLocalError(''); setRegisterData({ ...registerData, confirmPassword: e.target.value }); }}
                      required
                      minLength={6}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
                    {loading ? <><span className="spinner" /> Creating Account...</> : 'Create Account'}
                  </button>
                </form>
              )}

              <div className="auth-footer">
                {authMode === 'login' ? (
                  <>Don't have an account?{' '}
                    <button className="auth-switch-btn" onClick={() => { dispatch(clearError()); setLocalError(''); setAuthMode('register'); }}>
                      Create one
                    </button>
                  </>
                ) : (
                  <>Already have an account?{' '}
                    <button className="auth-switch-btn" onClick={() => { dispatch(clearError()); setLocalError(''); setAuthMode('login'); }}>
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero */}
      <section className="home-hero">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />

        <div className="container">
          <motion.div
            className="hero-content"
            initial="hidden"
            animate="visible"
            variants={heroFade}
          >
            <motion.div className="hero-badge" custom={0} variants={heroFade}>
              <span className="hero-badge-dot" />
              <HiShieldCheck /> AI-Powered News Verification
            </motion.div>

            <motion.h1 className="hero-title" custom={1} variants={heroFade}>
              Detect{' '}
              <span className="hero-title-highlight">Fake News</span>
              <br />
              Before It Spreads
            </motion.h1>

            <motion.p className="hero-subtitle" custom={2} variants={heroFade}>
              Paste any news article, upload images, or submit videos — our machine
              learning models analyze them for authenticity in seconds.
            </motion.p>

            <motion.div className="hero-actions" custom={3} variants={heroFade}>
              <button
                className="btn btn-primary btn-lg hero-cta-primary"
                onClick={() => handleProtectedNav('/analyze')}
              >
                Analyze Text <FiArrowRight />
              </button>
              <button
                className="btn btn-secondary btn-lg"
                onClick={() => handleProtectedNav('/media-analyze')}
              >
                Analyze Media <FiArrowRight />
              </button>
            </motion.div>

            <motion.div className="hero-stats" custom={4} variants={heroFade}>
              {stats.map((s) => (
                <div className="hero-stat" key={s.label}>
                  <div className="hero-stat-number">{s.number}</div>
                  <div className="hero-stat-label">{s.label}</div>
                </div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="home-features">
        <div className="container">
          <SectionHeader
            label="Features"
            title="Everything You Need to Verify News"
            desc="Comprehensive AI tools to detect misinformation and evaluate news credibility."
          />
          <div className="feature-grid">
            {features.map((f, i) => (
              <FeatureCard key={i} index={i} {...f} />
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="home-how">
        <div className="container">
          <SectionHeader
            label="How It Works"
            title="Four Simple Steps"
            desc="Verify any news article in under 30 seconds."
          />
          <div className="steps-grid">
            {steps.map((s, i) => (
              <StepCard key={i} index={i} {...s} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="home-cta">
        <div className="container">
          <motion.div
            className="cta-card"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="cta-glow" />
            {isAuthenticated ? (
              <>
                <h2 className="cta-title">Start Fighting Misinformation</h2>
                <p className="cta-desc">
                  You're all set. Analyze articles, images, and videos, or review your personal
                  analysis history from your dashboard.
                </p>
                <div className="hero-actions">
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={() => navigate('/analyze')}
                  >
                    Start Analyzing <FiArrowRight />
                  </button>
                  <button
                    className="btn btn-secondary btn-lg"
                    onClick={() => navigate('/dashboard')}
                  >
                    My Dashboard <FiArrowRight />
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="cta-title">Ready to Fight Misinformation?</h2>
                <p className="cta-desc">
                  Create a free account to save your analysis history, access your
                  dashboard, and help improve our AI models.
                </p>
                <div className="hero-actions">
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={() => openAuthModal('register')}
                  >
                    Create Free Account <FiArrowRight />
                  </button>
                  <button
                    className="btn btn-secondary btn-lg"
                    onClick={() => openAuthModal('login')}
                  >
                    Sign In
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </div>
      </section>

    </div>
  );
};

export default HomePage;
