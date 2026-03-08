import React from 'react';
import { motion } from 'framer-motion';

const SectionHeader = ({ label, title, desc }) => (
  <motion.div
    className="section-header"
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
  >
    {label && <div className="section-label">{label}</div>}
    <h2 className="section-title">{title}</h2>
    {desc && <p className="section-desc">{desc}</p>}
  </motion.div>
);

export default SectionHeader;
