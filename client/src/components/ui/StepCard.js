import React from 'react';
import { motion } from 'framer-motion';

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.55, ease: [0.4, 0, 0.2, 1] },
  }),
};

const gradients = [
  'linear-gradient(135deg, #7C3AED, #3B82F6)',
  'linear-gradient(135deg, #3B82F6, #2DD4BF)',
  'linear-gradient(135deg, #2DD4BF, #34D399)',
  'linear-gradient(135deg, #F472B6, #FBBF24)',
];

const StepCard = ({ icon, title, desc, index }) => (
  <motion.div
    className="step-card"
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true, margin: '-40px' }}
    custom={index}
    variants={fadeUp}
  >
    <div
      className="step-number"
      style={{ background: gradients[index % gradients.length] }}
    >
      {index + 1}
    </div>
    <div className="step-icon">{icon}</div>
    <h3 className="step-title">{title}</h3>
    <p className="step-desc">{desc}</p>
  </motion.div>
);

export default StepCard;
