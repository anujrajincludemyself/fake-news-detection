import React from 'react';
import { motion } from 'framer-motion';

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.55, ease: [0.4, 0, 0.2, 1] },
  }),
};

const FeatureCard = ({ icon, color, title, desc, index }) => (
  <motion.div
    className={`feature-card feature-card--${color}`}
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true, margin: '-40px' }}
    custom={index}
    variants={fadeUp}
    whileHover={{ y: -6, transition: { duration: 0.25 } }}
  >
    <div className={`feature-icon feature-icon--${color}`}>{icon}</div>
    <h3 className="feature-title">{title}</h3>
    <p className="feature-desc">{desc}</p>
  </motion.div>
);

export default FeatureCard;
