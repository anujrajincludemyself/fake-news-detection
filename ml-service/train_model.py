"""
Fake News Detection - ML Model Training Script

Dataset Sources (download one of these):
1. Kaggle Fake News Dataset:
   https://www.kaggle.com/c/fake-news/data
   -> Download train.csv and place in ml-service/data/

2. LIAR Dataset:
   https://www.cs.ucsb.edu/~william/data/liar_dataset.zip

3. ISOT Fake News Dataset:
   https://onlineacademiccommunity.uvic.ca/isot/2022/11/27/fake-news-detection-datasets/

4. FakeNewsNet:
   https://github.com/KaiDMML/FakeNewsNet

Instructions:
  1. Download the dataset from one of the sources above
  2. Place the CSV file(s) in the ml-service/data/ directory
  3. The CSV should have at least these columns: 'text' and 'label'
     - For Kaggle dataset: columns are 'title', 'text', 'label' (0=reliable, 1=unreliable)
  4. Run: python train_model.py
  5. The trained model will be saved to ml-service/models/
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
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, VotingClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
from sklearn.pipeline import Pipeline

# Download NLTK data
nltk.download('stopwords', quiet=True)
nltk.download('punkt', quiet=True)
nltk.download('punkt_tab', quiet=True)

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

stemmer = PorterStemmer()
stop_words = set(stopwords.words('english'))


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


def load_dataset():
    """Load and prepare dataset from CSV files in data directory."""
    os.makedirs(DATA_DIR, exist_ok=True)

    csv_files = [f for f in os.listdir(DATA_DIR) if f.endswith('.csv')]

    if not csv_files:
        print(f'\n[ERROR] No CSV files found in {DATA_DIR}/')
        print('Please download a dataset and place the CSV file(s) there.')
        print('See the docstring at the top of this file for dataset sources.')
        sys.exit(1)

    frames = []
    for csv_file in csv_files:
        filepath = os.path.join(DATA_DIR, csv_file)
        print(f'Loading {csv_file}...')
        df = pd.read_csv(filepath)

        # Handle different column naming conventions
        text_col = None
        label_col = None

        for col in df.columns:
            cl = col.lower()
            if cl in ['text', 'news_text', 'article_text', 'content', 'body']:
                text_col = col
            elif cl in ['label', 'class', 'target', 'is_fake', 'fake']:
                label_col = col

        if text_col is None:
            # Fallback: combine title + text if available
            if 'title' in [c.lower() for c in df.columns]:
                title_col = [c for c in df.columns if c.lower() == 'title'][0]
                # Check for any text-like column
                for col in df.columns:
                    if col.lower() not in ['id', 'title', 'label', 'class', 'target']:
                        text_col = col
                        break
                if text_col:
                    df['combined_text'] = df[title_col].fillna('') + ' ' + df[text_col].fillna('')
                    text_col = 'combined_text'
                else:
                    text_col = title_col
            else:
                print(f'  WARNING: Could not find text column in {csv_file}, skipping.')
                continue

        if label_col is None:
            # ISOT-style: label is implied by filename (Fake.csv -> 1, True.csv -> 0)
            fname_lower = csv_file.lower()
            if fname_lower.startswith('fake'):
                df['label'] = 1
                label_col = 'label'
                print(f'  Inferred label=1 (FAKE) from filename.')
            elif fname_lower.startswith('true') or fname_lower.startswith('real'):
                df['label'] = 0
                label_col = 'label'
                print(f'  Inferred label=0 (REAL) from filename.')
            else:
                print(f'  WARNING: Could not find label column in {csv_file}, skipping.')
                continue

        subset = df[[text_col, label_col]].copy()
        subset.columns = ['text', 'label']
        frames.append(subset)
        print(f'  Found {len(subset)} records.')

    if not frames:
        print('[ERROR] No usable data found.')
        sys.exit(1)

    combined = pd.concat(frames, ignore_index=True)
    combined.dropna(subset=['text', 'label'], inplace=True)

    # Normalize labels to 0 (REAL) and 1 (FAKE)
    unique_labels = combined['label'].unique()
    print(f'Unique labels found: {unique_labels}')

    if set(unique_labels) <= {0, 1}:
        pass  # already numeric
    elif set(unique_labels) <= {'REAL', 'FAKE'}:
        combined['label'] = combined['label'].map({'REAL': 0, 'FAKE': 1})
    elif set(unique_labels) <= {'reliable', 'unreliable'}:
        combined['label'] = combined['label'].map({'reliable': 0, 'unreliable': 1})
    elif set(unique_labels) <= {'true', 'false'}:
        combined['label'] = combined['label'].map({'true': 0, 'false': 1})
    else:
        # Try numeric conversion
        try:
            combined['label'] = combined['label'].astype(int)
            combined = combined[combined['label'].isin([0, 1])]
        except (ValueError, TypeError):
            print(f'[ERROR] Cannot interpret labels: {unique_labels}')
            sys.exit(1)

    print(f'\nTotal dataset size: {len(combined)}')
    print(f'Label distribution:\n{combined["label"].value_counts()}')

    return combined


def train():
    """Train the fake news detection model."""
    print('=' * 60)
    print('  FAKE NEWS DETECTION MODEL TRAINING')
    print('=' * 60)

    # Load data
    df = load_dataset()

    # Preprocess
    print('\nPreprocessing text data...')
    df['processed_text'] = df['text'].apply(preprocess_text)

    # Remove empty texts
    df = df[df['processed_text'].str.len() > 0]

    X = df['processed_text']
    y = df['label']

    # Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f'Training set: {len(X_train)}, Test set: {len(X_test)}')

    # Build pipeline with ensemble model
    print('\nTraining model (this may take a few minutes)...')

    tfidf = TfidfVectorizer(
        max_features=50000,
        ngram_range=(1, 3),
        min_df=2,
        max_df=0.95,
        sublinear_tf=True,
    )

    # Individual classifiers
    lr = LogisticRegression(max_iter=1000, C=1.0, random_state=42)
    rf = RandomForestClassifier(n_estimators=200, max_depth=50, random_state=42, n_jobs=-1)
    gb = GradientBoostingClassifier(n_estimators=150, max_depth=5, random_state=42)

    # Create ensemble
    ensemble = VotingClassifier(
        estimators=[('lr', lr), ('rf', rf), ('gb', gb)],
        voting='soft',
    )

    # Fit TF-IDF
    X_train_tfidf = tfidf.fit_transform(X_train)
    X_test_tfidf = tfidf.transform(X_test)

    # Train ensemble
    ensemble.fit(X_train_tfidf, y_train)

    # Evaluate
    y_pred = ensemble.predict(X_test_tfidf)
    accuracy = accuracy_score(y_test, y_pred)

    print(f'\n{"=" * 60}')
    print(f'  MODEL EVALUATION RESULTS')
    print(f'{"=" * 60}')
    print(f'\nAccuracy: {accuracy:.4f}')
    print(f'\nClassification Report:')
    print(classification_report(y_test, y_pred, target_names=['REAL', 'FAKE']))
    print(f'Confusion Matrix:')
    print(confusion_matrix(y_test, y_pred))

    # Cross-validation
    print('\nRunning 5-fold cross-validation on Logistic Regression...')
    cv_pipeline = Pipeline([
        ('tfidf', TfidfVectorizer(max_features=50000, ngram_range=(1, 2), sublinear_tf=True)),
        ('clf', LogisticRegression(max_iter=1000, random_state=42)),
    ])
    cv_scores = cross_val_score(cv_pipeline, X, y, cv=5, scoring='accuracy')
    print(f'CV Accuracy: {cv_scores.mean():.4f} (+/- {cv_scores.std() * 2:.4f})')

    # Save model and vectorizer
    os.makedirs(MODELS_DIR, exist_ok=True)

    model_path = os.path.join(MODELS_DIR, 'fake_news_model.joblib')
    vectorizer_path = os.path.join(MODELS_DIR, 'tfidf_vectorizer.joblib')

    joblib.dump(ensemble, model_path)
    joblib.dump(tfidf, vectorizer_path)

    print(f'\nModel saved to: {model_path}')
    print(f'Vectorizer saved to: {vectorizer_path}')
    print(f'\nTraining complete! You can now start the ML service.')


if __name__ == '__main__':
    train()
