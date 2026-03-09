"""
Fake News Detection - ML Model Training Script

Supported datasets (place files in ml-service/data/):
──────────────────────────────────────────────────────
1. ISOT Fake News Dataset (already included):
   Fake.csv  →  label 1 (FAKE)
   True.csv  →  label 0 (REAL)

2. WELFake Dataset (RECOMMENDED — adds diversity):
   https://www.kaggle.com/datasets/saurabhshahane/fake-news-classification
   Download:  WELFake_Dataset.csv
   Columns:   title, text, label  (0=REAL, 1=FAKE)

3. LIAR Dataset (political claims, short text):
   https://www.cs.ucsb.edu/~william/data/liar_dataset.zip
   Extract files:  train.tsv, valid.tsv, test.tsv  into data/
   (Auto-detected as TSV; no header row)

4. Kaggle Fake News Dataset:
   https://www.kaggle.com/c/fake-news/data
   Download:  train.csv
   Columns:   title, text, label  (0=reliable, 1=unreliable)

Instructions:
  1. Download one or more datasets above and place files in ml-service/data/
  2. Run:  python train_model.py
  3. Trained model is saved to ml-service/models/
"""

import os
import re
import sys
import joblib
import numpy as np
import pandas as pd
import nltk
from nltk.corpus import stopwords
from nltk.stem import PorterStemmer
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, PassiveAggressiveClassifier
from sklearn.pipeline import Pipeline, FeatureUnion
from sklearn.preprocessing import MaxAbsScaler
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
from sklearn.utils import resample

# Download NLTK data
nltk.download('stopwords', quiet=True)
nltk.download('punkt', quiet=True)
nltk.download('punkt_tab', quiet=True)

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

stemmer = PorterStemmer()
stop_words = set(stopwords.words('english'))

# LIAR label mapping: 3 truthful grades → REAL, 3 deceptive grades → FAKE
LIAR_LABEL_MAP = {
    'true': 0,
    'mostly-true': 0,
    'half-true': 0,
    'barely-true': 1,
    'false': 1,
    'pants-fire': 1,
}


def preprocess_text(text):
    """Clean and preprocess text for model input."""
    if not isinstance(text, str):
        return ''

    # Lowercase
    text = text.lower()

    # Remove URLs
    text = re.sub(r'http\S+|www\S+|https\S+', '', text)

    # Remove HTML tags
    text = re.sub(r'<.*?>', '', text)

    # Remove special characters and digits
    text = re.sub(r'[^a-zA-Z\s]', '', text)

    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text).strip()

    # Tokenize, remove stopwords, and stem
    words = text.split()
    words = [stemmer.stem(w) for w in words if w not in stop_words and len(w) > 2]

    return ' '.join(words)


# ─────────────────────────────────────────────────────────
# STRUCTURAL FEATURE EXTRACTOR
# These features capture writing style signals that are
# source-agnostic (not tied to Reuters vs WorldNetDaily
# vocabulary), which reduces domain-bias in the model.
# ─────────────────────────────────────────────────────────

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
    """Extract writing-style features that are independent of topic vocabulary."""

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

        # 1. Avg word length (fake news tends toward shorter, punchy words)
        avg_word_len = np.mean([len(w) for w in words]) if words else 0

        # 2. Avg sentence length
        avg_sent_len = np.mean([len(s.split()) for s in sentences]) if sentences else 0

        # 3. Caps ratio (excessive caps = sensationalism)
        caps_ratio = sum(1 for c in text if c.isupper()) / max(len(text), 1)

        # 4. Exclamation density
        excl_density = text.count('!') / word_count

        # 5. Question mark density
        quest_density = text.count('?') / word_count

        # 6. Quote usage (real news quotes sources)
        quote_density = (text.count('"') + text.count("'")) / word_count

        # 7. Has source attribution
        has_source = float(any(re.search(p, text_lower) for p in SOURCE_PATTERNS))

        # 8. Clickbait score (0–1 normalized)
        clickbait_count = sum(1 for p in CLICKBAIT_PATTERNS if re.search(p, text_lower))
        clickbait_score = min(clickbait_count / 3.0, 1.0)

        # 9. Emotional word density
        emotional_density = sum(1 for w in words if w.lower() in EMOTIONAL_WORDS) / word_count

        # 10. Has statistical claims
        has_stats = float(bool(re.search(r'\d+(\.\d+)?%|\d+ percent|\$[\d,.]+', text)))

        # 11. Lexical diversity (unique words / total words)
        lexical_diversity = len(set(w.lower() for w in words)) / word_count

        # 12. Text length (log-scaled)
        text_len = np.log1p(word_count)

        return np.array([
            avg_word_len, avg_sent_len, caps_ratio, excl_density,
            quest_density, quote_density, has_source, clickbait_score,
            emotional_density, has_stats, lexical_diversity, text_len,
        ], dtype=np.float32)


def load_liar_tsv(filepath, filename):
    """Load LIAR dataset TSV file (no header, fixed column positions)."""
    try:
        df = pd.read_csv(filepath, sep='\t', header=None, on_bad_lines='skip')
        # Column 1 = label string, Column 2 = statement text
        if df.shape[1] < 3:
            print(f'  WARNING: {filename} has unexpected TSV structure, skipping.')
            return None
        subset = pd.DataFrame({
            'text': df.iloc[:, 2].astype(str),
            'label': df.iloc[:, 1].map(LIAR_LABEL_MAP),
        })
        subset.dropna(subset=['label'], inplace=True)
        subset['label'] = subset['label'].astype(int)
        print(f'  Loaded {len(subset)} LIAR records from {filename}.')
        return subset
    except Exception as e:
        print(f'  WARNING: Could not parse {filename} as LIAR TSV: {e}')
        return None


def load_dataset():
    """Load and prepare dataset from all CSV/TSV files in data directory."""
    os.makedirs(DATA_DIR, exist_ok=True)

    all_files = os.listdir(DATA_DIR)
    csv_files = [f for f in all_files if f.endswith('.csv')]
    tsv_files = [f for f in all_files if f.endswith('.tsv')]

    if not csv_files and not tsv_files:
        print(f'\n[ERROR] No CSV/TSV files found in {DATA_DIR}/')
        print('Please download a dataset and place the file(s) there.')
        print('See the docstring at the top of this file for dataset sources.')
        sys.exit(1)

    frames = []

    # ── TSV files (LIAR dataset) ──────────────────────────────
    for tsv_file in tsv_files:
        filepath = os.path.join(DATA_DIR, tsv_file)
        result = load_liar_tsv(filepath, tsv_file)
        if result is not None:
            frames.append(result)

    # ── CSV files ─────────────────────────────────────────────
    for csv_file in csv_files:
        filepath = os.path.join(DATA_DIR, csv_file)
        print(f'Loading {csv_file}...')
        try:
            df = pd.read_csv(filepath)
        except Exception as e:
            print(f'  WARNING: Could not read {csv_file}: {e}')
            continue

        cols_lower = {c.lower(): c for c in df.columns}
        text_col = None
        label_col = None

        # Find label column
        for key in ['label', 'class', 'target', 'is_fake', 'fake']:
            if key in cols_lower:
                label_col = cols_lower[key]
                break

        # Find text column
        for key in ['text', 'news_text', 'article_text', 'content', 'body', 'statement']:
            if key in cols_lower:
                text_col = cols_lower[key]
                break

        # WELFake / Kaggle: combine title + text
        if text_col is None and 'title' in cols_lower:
            title_col = cols_lower['title']
            # Use any remaining non-metadata column as body
            skip = {'id', 'title', 'label', 'class', 'target', 'unnamed: 0'}
            body_col = next((cols_lower[k] for k in cols_lower if k not in skip), None)
            if body_col:
                df['_combined'] = df[title_col].fillna('') + ' ' + df[body_col].fillna('')
                text_col = '_combined'
            else:
                text_col = title_col

        if text_col is None:
            print(f'  WARNING: Could not find text column in {csv_file}, skipping.')
            continue

        if label_col is None:
            fname_lower = csv_file.lower()
            if fname_lower.startswith('fake'):
                df['_label'] = 1
                label_col = '_label'
                print(f'  Inferred label=1 (FAKE) from filename.')
            elif fname_lower.startswith('true') or fname_lower.startswith('real'):
                df['_label'] = 0
                label_col = '_label'
                print(f'  Inferred label=0 (REAL) from filename.')
            else:
                print(f'  WARNING: Could not find label column in {csv_file}, skipping.')
                continue

        subset = df[[text_col, label_col]].copy()
        subset.columns = ['text', 'label']
        subset.dropna(subset=['text', 'label'], inplace=True)

        # Normalize labels → 0 (REAL) / 1 (FAKE)
        unique = set(subset['label'].dropna().unique())
        if unique <= {0, 1, 0.0, 1.0}:
            subset['label'] = subset['label'].astype(int)
        elif unique <= {'REAL', 'FAKE'}:
            subset['label'] = subset['label'].map({'REAL': 0, 'FAKE': 1})
        elif unique <= {'real', 'fake'}:
            subset['label'] = subset['label'].map({'real': 0, 'fake': 1})
        elif unique <= {'reliable', 'unreliable'}:
            subset['label'] = subset['label'].map({'reliable': 0, 'unreliable': 1})
        elif unique <= {'true', 'false'}:
            subset['label'] = subset['label'].map({'true': 0, 'false': 1})
        elif unique <= {'TRUE', 'FALSE'}:
            subset['label'] = subset['label'].map({'TRUE': 0, 'FALSE': 1})
        elif unique <= {'0', '1'}:
            subset['label'] = subset['label'].astype(int)
        else:
            # Try LIAR-style multi-class mapping
            mapped = subset['label'].map(LIAR_LABEL_MAP)
            if mapped.notna().sum() > len(subset) * 0.5:
                subset['label'] = mapped
            else:
                try:
                    subset['label'] = subset['label'].astype(int)
                    subset = subset[subset['label'].isin([0, 1])]
                except (ValueError, TypeError):
                    print(f'  WARNING: Cannot interpret labels {unique} in {csv_file}, skipping.')
                    continue

        subset.dropna(subset=['label'], inplace=True)
        subset['label'] = subset['label'].astype(int)
        subset = subset[subset['label'].isin([0, 1])]

        print(f'  Found {len(subset)} records  '
              f'(REAL={int((subset["label"]==0).sum())}, FAKE={int((subset["label"]==1).sum())})')
        frames.append(subset)

    if not frames:
        print('[ERROR] No usable data found.')
        sys.exit(1)

    combined = pd.concat(frames, ignore_index=True)

    # Balance across datasets: cap each source at 2× the minority class size
    # to prevent ISOT from dominating when additional datasets are smaller
    max_per_class = combined['label'].value_counts().min() * 2
    real_df = combined[combined['label'] == 0]
    fake_df = combined[combined['label'] == 1]
    if len(real_df) > max_per_class:
        real_df = real_df.sample(max_per_class, random_state=42)
    if len(fake_df) > max_per_class:
        fake_df = fake_df.sample(max_per_class, random_state=42)
    combined = pd.concat([real_df, fake_df]).sample(frac=1, random_state=42).reset_index(drop=True)

    print(f'\nFinal dataset: {len(combined)} records')
    print(f'Label distribution:\n{combined["label"].value_counts()}')

    return combined


def train():
    """Train the fake news detection model."""
    print('=' * 60)
    print('  FAKE NEWS DETECTION MODEL TRAINING')
    print('=' * 60)

    # Load and balance data
    df = load_dataset()

    # Preprocess text
    print('\nPreprocessing text data...')
    df['processed_text'] = df['text'].apply(preprocess_text)
    df = df[df['processed_text'].str.len() > 0]

    X_raw = df['text'].values          # original text for structural features
    X_proc = df['processed_text'].values  # preprocessed text for TF-IDF
    y = df['label'].values

    # Split (stratified to keep label balance)
    (X_raw_train, X_raw_test,
     X_proc_train, X_proc_test,
     y_train, y_test) = train_test_split(
        X_raw, X_proc, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f'Training: {len(X_train) if False else len(X_proc_train)}, '
          f'Test: {len(X_proc_test)}')

    # ── Feature extraction ──────────────────────────────────
    print('\nBuilding feature pipeline...')

    tfidf = TfidfVectorizer(
        max_features=60000,
        ngram_range=(1, 2),   # bigrams sufficient; trigrams slow without extra gain
        min_df=2,
        max_df=0.95,
        sublinear_tf=True,
        analyzer='word',
    )

    struct_extractor = StructuralFeatureExtractor()

    # Fit TF-IDF on preprocessed text; structural features on raw text
    X_tfidf_train = tfidf.fit_transform(X_proc_train)
    X_tfidf_test = tfidf.transform(X_proc_test)

    from scipy.sparse import hstack, csr_matrix
    X_struct_train = csr_matrix(struct_extractor.fit_transform(X_raw_train))
    X_struct_test = csr_matrix(struct_extractor.transform(X_raw_test))

    X_train_feat = hstack([X_tfidf_train, X_struct_train])
    X_test_feat = hstack([X_tfidf_test, X_struct_test])

    # ── Classifier ──────────────────────────────────────────
    # PassiveAggressiveClassifier generalizes well across diverse text domains.
    # CalibratedClassifierCV wraps it to produce accurate probabilities (needed
    # for the blending logic in app.py).
    print('\nTraining calibrated classifier...')
    base_clf = PassiveAggressiveClassifier(
        C=0.1, max_iter=1000, random_state=42, class_weight='balanced',
    )
    clf = CalibratedClassifierCV(base_clf, cv=3, method='sigmoid')
    clf.fit(X_train_feat, y_train)

    # ── Evaluation ──────────────────────────────────────────
    y_pred = clf.predict(X_test_feat)
    accuracy = accuracy_score(y_test, y_pred)

    print(f'\n{"=" * 60}')
    print(f'  MODEL EVALUATION RESULTS')
    print(f'{"=" * 60}')
    print(f'\nAccuracy: {accuracy:.4f}')
    print(f'\nClassification Report:')
    print(classification_report(y_test, y_pred, target_names=['REAL', 'FAKE']))
    print('Confusion Matrix:')
    print(confusion_matrix(y_test, y_pred))

    # Quick cross-val check with a plain LR pipeline for reference
    print('\nRunning 5-fold cross-validation (Logistic Regression reference)...')
    cv_pipeline = Pipeline([
        ('tfidf', TfidfVectorizer(
            max_features=60000, ngram_range=(1, 2), sublinear_tf=True)),
        ('clf', LogisticRegression(
            max_iter=1000, random_state=42, class_weight='balanced')),
    ])
    cv_scores = cross_val_score(
        cv_pipeline, X_proc, y, cv=StratifiedKFold(5), scoring='accuracy'
    )
    print(f'CV Accuracy: {cv_scores.mean():.4f} (+/- {cv_scores.std() * 2:.4f})')

    # ── Save ────────────────────────────────────────────────
    os.makedirs(MODELS_DIR, exist_ok=True)

    model_path = os.path.join(MODELS_DIR, 'fake_news_model.joblib')
    vectorizer_path = os.path.join(MODELS_DIR, 'tfidf_vectorizer.joblib')
    struct_path = os.path.join(MODELS_DIR, 'structural_extractor.joblib')

    joblib.dump(clf, model_path)
    joblib.dump(tfidf, vectorizer_path)
    joblib.dump(struct_extractor, struct_path)

    print(f'\nModel saved      → {model_path}')
    print(f'Vectorizer saved → {vectorizer_path}')
    print(f'Struct extractor → {struct_path}')
    print(f'\nTraining complete! You can now start the ML service.')


if __name__ == '__main__':
    train()
