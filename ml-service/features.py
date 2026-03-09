"""
Shared feature extraction — imported by both train_model.py and app.py
so that joblib can correctly pickle/unpickle StructuralFeatureExtractor.
"""

import re
import numpy as np
from sklearn.base import BaseEstimator, TransformerMixin

SOURCE_PATTERNS = [
    r'according to', r'reported by', r'study shows', r'research finds',
    r'officials said', r'spokesperson', r'published in', r'per reports',
    r'confirmed by', r'sources say',
]

CLICKBAIT_PATTERNS = [
    r"you won't believe", r'shocking', r'mind.blowing', r'what happens next',
    r'exposed', r'they don.t want you to know', r'unbelievable', r'jaw.dropping',
    r'secret revealed', r'must see',
]

EMOTIONAL_WORDS = {
    'outrage', 'fury', 'terrifying', 'devastating', 'horrifying',
    'incredible', 'disgusting', 'destroy', 'catastrophe', 'panic',
    'bombshell', 'explosive', 'chaos', 'scandal', 'nightmare', 'hoax',
}


class StructuralFeatureExtractor(BaseEstimator, TransformerMixin):
    """Extract writing-style features independent of topic vocabulary."""

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return np.array([self._features(text) for text in X], dtype=np.float32)

    def _features(self, text):
        if not isinstance(text, str) or not text.strip():
            return np.zeros(12, dtype=np.float32)
        words = text.split()
        sentences = re.split(r'[.!?]+', text)
        sentences = [s.strip() for s in sentences if s.strip()]
        word_count = max(len(words), 1)
        text_lower = text.lower()
        avg_word_len = np.mean([len(w) for w in words]) if words else 0
        avg_sent_len = np.mean([len(s.split()) for s in sentences]) if sentences else 0
        caps_ratio = sum(1 for c in text if c.isupper()) / max(len(text), 1)
        excl_density = text.count('!') / word_count
        quest_density = text.count('?') / word_count
        quote_density = (text.count('"') + text.count("'")) / word_count
        has_source = float(any(re.search(p, text_lower) for p in SOURCE_PATTERNS))
        clickbait_count = sum(1 for p in CLICKBAIT_PATTERNS if re.search(p, text_lower))
        clickbait_score = min(clickbait_count / 3.0, 1.0)
        emotional_density = sum(1 for w in words if w.lower() in EMOTIONAL_WORDS) / word_count
        has_stats = float(bool(re.search(r'\d+(\.\d+)?%|\d+ percent|\$[\d,.]+', text)))
        lexical_diversity = len(set(w.lower() for w in words)) / word_count
        text_len = np.log1p(word_count)
        return np.array([
            avg_word_len, avg_sent_len, caps_ratio, excl_density,
            quest_density, quote_density, has_source, clickbait_score,
            emotional_density, has_stats, lexical_diversity, text_len,
        ], dtype=np.float32)
