import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  HiShieldCheck,
  HiLightningBolt,
  HiChartBar,
  HiDatabase,
  HiPhotograph,
  HiFilm,
} from 'react-icons/hi';
import { FiArrowRight, FiSearch, FiCpu, FiCheckCircle, FiBarChart2 } from 'react-icons/fi';
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
  return (
    <div className="home-page">

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
              <Link to="/analyze" className="btn btn-primary btn-lg hero-cta-primary">
                Analyze Text <FiArrowRight />
              </Link>
              <Link to="/media-analyze" className="btn btn-secondary btn-lg">
                Analyze Media <FiArrowRight />
              </Link>
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
            <h2 className="cta-title">Ready to Fight Misinformation?</h2>
            <p className="cta-desc">
              Create a free account to save your analysis history, access your
              dashboard, and help improve our AI models.
            </p>
            <div className="hero-actions">
              <Link to="/register" className="btn btn-primary btn-lg">
                Create Free Account <FiArrowRight />
              </Link>
              <Link to="/analyze" className="btn btn-secondary btn-lg">
                Try Without Account
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

    </div>
  );
};

export default HomePage;
