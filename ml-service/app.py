"""
Fake News Detection ML Microservice

FastAPI server that loads a trained model and exposes prediction endpoints.
Falls back to heuristic analysis if no trained model is available.
Includes image and video fake detection via forensic analysis.
"""

import os
import re
import io
import math
import struct
import logging
import tempfile
from contextlib import asynccontextmanager

import joblib
import nltk
import numpy as np
from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from nltk.corpus import stopwords
from nltk.stem import PorterStemmer
from PIL import Image, ImageChops, ImageEnhance, ExifTags

# Setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

nltk.download('stopwords', quiet=True)
nltk.download('punkt', quiet=True)
nltk.download('punkt_tab', quiet=True)

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
stemmer = PorterStemmer()
stop_words = set(stopwords.words('english'))

# Global model references
model = None
vectorizer = None
struct_extractor = None


def preprocess_text(text: str) -> str:
    """Clean and preprocess text for model input."""
    if not isinstance(text, str):
        return ''
    text = text.lower()
    text = re.sub(r'http\S+|www\S+|https\S+', '', text)
    text = re.sub(r'<.*?>', '', text)
    text = re.sub(r'[^a-zA-Z\s]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    words = text.split()
    words = [stemmer.stem(w) for w in words if w not in stop_words and len(w) > 2]
    return ' '.join(words)


def load_model():
    """Load trained model, vectorizer, and structural extractor."""
    global model, vectorizer, struct_extractor

    model_path = os.path.join(MODELS_DIR, 'fake_news_model.joblib')
    vectorizer_path = os.path.join(MODELS_DIR, 'tfidf_vectorizer.joblib')
    struct_path = os.path.join(MODELS_DIR, 'structural_extractor.joblib')

    if os.path.exists(model_path) and os.path.exists(vectorizer_path):
        model = joblib.load(model_path)
        vectorizer = joblib.load(vectorizer_path)
        if os.path.exists(struct_path):
            struct_extractor = joblib.load(struct_path)
            logger.info('Trained model + structural extractor loaded successfully.')
        else:
            logger.info('Trained model loaded (no structural extractor found — old model).')
        return True
    else:
        logger.warning('No trained model found. Service will use heuristic analysis.')
        logger.warning('Run train_model.py first to train the ML model.')
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    yield


app = FastAPI(
    title='Fake News Detection ML Service',
    description='AI-powered fake news detection microservice',
    version='1.0.0',
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


# --- Schemas ---
class PredictionRequest(BaseModel):
    text: str = Field(..., min_length=10, description='News text to analyze')


class CredibilityIndicators(BaseModel):
    hasClickbait: bool = False
    hasEmotionalLanguage: bool = False
    hasSourceAttribution: bool = False
    hasStatisticalClaims: bool = False
    readabilityScore: float = 0.0


class PredictionDetails(BaseModel):
    sentimentScore: float = 0.0
    subjectivityScore: float = 0.0
    credibilityIndicators: CredibilityIndicators = CredibilityIndicators()


class PredictionResponse(BaseModel):
    label: str
    confidence: float
    details: PredictionDetails
    model_used: str


# --- Heuristic fallback ---
CLICKBAIT_PATTERNS = [
    r'you won\'t believe', r'shocking', r'mind-blowing', r'what happens next',
    r'exposed', r'secret', r'they don\'t want you to know', r'breaking',
    r'unbelievable', r'jaw-dropping',
]

EMOTIONAL_WORDS = {
    'outrage', 'fury', 'terrifying', 'devastating', 'horrifying',
    'incredible', 'amazing', 'disgusting', 'destroy', 'catastrophe',
    'crisis', 'panic', 'fear', 'hate', 'miracle', 'nightmare',
    'scandal', 'chaos', 'explosive', 'bombshell',
}


def heuristic_predict(text: str) -> dict:
    """Fallback heuristic-based prediction when no ML model is available."""
    text_lower = text.lower()
    words = text_lower.split()
    word_count = len(words)

    score = 50  # baseline credibility

    # Clickbait detection
    has_clickbait = any(re.search(p, text_lower) for p in CLICKBAIT_PATTERNS)
    if has_clickbait:
        score -= 15

    # Emotional language
    emotional_count = sum(1 for w in words if w in EMOTIONAL_WORDS)
    has_emotional = emotional_count >= 2
    if has_emotional:
        score -= 10

    # Source attribution
    source_patterns = [
        r'according to', r'reported by', r'study shows', r'research finds',
        r'officials said', r'spokesperson', r'published in',
    ]
    has_source = any(re.search(p, text_lower) for p in source_patterns)
    if has_source:
        score += 15

    # Statistical claims
    has_stats = bool(re.search(r'\d+(\.\d+)?%|\d+ percent|\$[\d,.]+', text))
    if has_stats and has_source:
        score += 10

    # Caps and exclamation
    caps_ratio = sum(1 for c in text if c.isupper()) / max(len(text), 1)
    if caps_ratio > 0.3:
        score -= 10
    excl_count = text.count('!')
    if excl_count > 3:
        score -= 5

    # Short text penalty
    if word_count < 50:
        score -= 10

    score = max(0, min(100, score))

    if score >= 60:
        label = 'REAL'
        confidence = min(95, score + 10)
    elif score <= 35:
        label = 'FAKE'
        confidence = min(95, (100 - score) + 5)
    else:
        label = 'UNCERTAIN'
        confidence = 50 + abs(score - 50)

    return {
        'label': label,
        'confidence': round(confidence, 2),
        'credibility_score': score,
        'details': {
            'sentimentScore': 0,
            'subjectivityScore': 0,
            'credibilityIndicators': {
                'hasClickbait': has_clickbait,
                'hasEmotionalLanguage': has_emotional,
                'hasSourceAttribution': has_source,
                'hasStatisticalClaims': has_stats,
                'readabilityScore': min(100, max(0, word_count * 0.5)),
            },
        },
        'model_used': 'heuristic',
    }


# --- Endpoints ---
@app.get('/health')
async def health():
    return {
        'status': 'healthy',
        'model_loaded': model is not None,
    }


@app.post('/predict', response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    text = request.text.strip()

    if len(text) < 10:
        raise HTTPException(status_code=400, detail='Text is too short for analysis')

    if model is not None and vectorizer is not None:
        try:
            processed = preprocess_text(text)
            tfidf_features = vectorizer.transform([processed])

            # Combine with structural features if the new model is loaded
            if struct_extractor is not None:
                from scipy.sparse import hstack, csr_matrix
                struct_feat = csr_matrix(struct_extractor.transform([text]))
                features = hstack([tfidf_features, struct_feat])
            else:
                features = tfidf_features

            probabilities = model.predict_proba(features)[0]

            # P(FAKE) from ML model
            ml_fake_prob = float(probabilities[1])

            # Run heuristic for credibility signals and details
            heuristic = heuristic_predict(text)
            # Convert heuristic credibility score (0=fake, 100=real) to fake probability
            heuristic_credibility = heuristic.get('credibility_score', 50)
            heuristic_fake_prob = 1.0 - (heuristic_credibility / 100.0)

            # Blend: the ISOT-trained model is biased toward FAKE due to domain-specific
            # writing-style patterns (Reuters vs WorldNetDaily). Calibrate by weighting
            # in the heuristic's source-agnostic credibility signals.
            blended = 0.55 * ml_fake_prob + 0.45 * heuristic_fake_prob

            if blended >= 0.65:
                label = 'FAKE'
                confidence = round(blended * 100, 2)
            elif blended <= 0.35:
                label = 'REAL'
                confidence = round((1.0 - blended) * 100, 2)
            else:
                label = 'UNCERTAIN'
                confidence = round(max(blended, 1.0 - blended) * 100, 2)

            return {
                'label': label,
                'confidence': confidence,
                'details': heuristic['details'],
                'model_used': 'ensemble_ml',
            }
        except Exception as e:
            logger.error(f'ML prediction failed: {e}')
            result = heuristic_predict(text)
            result['model_used'] = 'heuristic_fallback'
            return result
    else:
        return heuristic_predict(text)


@app.get('/model/info')
async def model_info():
    return {
        'model_loaded': model is not None,
        'model_type': type(model).__name__ if model else None,
        'vectorizer_loaded': vectorizer is not None,
        'structural_extractor_loaded': struct_extractor is not None,
    }


# ──────────────────────────────────────────
# IMAGE FAKE DETECTION
# ──────────────────────────────────────────

ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/bmp'}
MAX_IMAGE_SIZE = 20 * 1024 * 1024  # 20 MB


def error_level_analysis(image: Image.Image, quality: int = 90) -> dict:
    """
    Perform Error Level Analysis (ELA).
    Resave at a known quality and measure difference —
    manipulated regions show higher error levels.
    """
    original = image.convert('RGB')
    buffer = io.BytesIO()
    original.save(buffer, 'JPEG', quality=quality)
    buffer.seek(0)
    resaved = Image.open(buffer)

    diff = ImageChops.difference(original, resaved)
    extrema = diff.getextrema()
    max_diff = max(ch[1] for ch in extrema)

    pixels = np.array(diff, dtype=np.float64)
    mean_error = float(np.mean(pixels))
    std_error = float(np.std(pixels))
    max_error = float(np.max(pixels))

    # Regions with high error suggest manipulation
    threshold = mean_error + 2 * std_error
    suspicious_pixels = int(np.sum(pixels > threshold))
    total_pixels = pixels.size
    suspicious_ratio = suspicious_pixels / total_pixels if total_pixels else 0

    return {
        'mean_error': round(mean_error, 3),
        'std_error': round(std_error, 3),
        'max_error': round(max_error, 3),
        'max_channel_diff': int(max_diff),
        'suspicious_pixel_ratio': round(suspicious_ratio, 5),
    }


def analyze_metadata(image: Image.Image) -> dict:
    """Extract and flag suspicious EXIF / metadata."""
    info = {}
    has_exif = False
    software = None
    has_edit_software = False

    try:
        exif_data = image._getexif()
        if exif_data:
            has_exif = True
            tag_map = {v: k for k, v in ExifTags.TAGS.items()}
            if 'Software' in tag_map and tag_map['Software'] in exif_data:
                software = str(exif_data[tag_map['Software']])
            # Check for common editing software
            edit_keywords = ['photoshop', 'gimp', 'paint', 'canva', 'affinity',
                             'lightroom', 'snapseed', 'picsart', 'faceapp']
            if software:
                has_edit_software = any(k in software.lower() for k in edit_keywords)
    except Exception:
        pass

    return {
        'has_exif': has_exif,
        'editing_software': software,
        'has_edit_software': has_edit_software,
        'format': image.format or 'UNKNOWN',
        'mode': image.mode,
        'size': {'width': image.width, 'height': image.height},
    }


def pixel_statistics(image: Image.Image) -> dict:
    """Statistical analysis of pixel distribution to detect anomalies."""
    arr = np.array(image.convert('RGB'), dtype=np.float64)

    # Per-channel stats
    channel_stats = {}
    for i, name in enumerate(['red', 'green', 'blue']):
        ch = arr[:, :, i].flatten()
        channel_stats[name] = {
            'mean': round(float(np.mean(ch)), 2),
            'std': round(float(np.std(ch)), 2),
        }

    # Uniformity check — very uniform images may be synthetic
    overall_std = float(np.std(arr))
    is_overly_uniform = overall_std < 15

    # Noise analysis — synthetic/AI images often have different noise profiles
    gray = np.mean(arr, axis=2)
    laplacian_var = float(np.var(gray[1:-1, 1:-1] * 4
                                  - gray[:-2, 1:-1]
                                  - gray[2:, 1:-1]
                                  - gray[1:-1, :-2]
                                  - gray[1:-1, 2:]))
    # Very low noise variance can indicate AI-generated images
    low_noise = laplacian_var < 50

    return {
        'channels': channel_stats,
        'overall_std': round(overall_std, 2),
        'is_overly_uniform': is_overly_uniform,
        'noise_variance': round(laplacian_var, 2),
        'low_noise_flag': low_noise,
    }


def analyze_image(image: Image.Image) -> dict:
    """Run full image forensic analysis and produce a verdict."""
    ela = error_level_analysis(image)
    metadata = analyze_metadata(image)
    stats = pixel_statistics(image)

    # Scoring (0 = definitely real, 100 = definitely fake)
    score = 0

    # ELA signals
    if ela['suspicious_pixel_ratio'] > 0.02:
        score += 20
    if ela['suspicious_pixel_ratio'] > 0.05:
        score += 10
    if ela['max_channel_diff'] > 50:
        score += 10
    if ela['mean_error'] > 8:
        score += 10

    # Metadata signals
    if metadata['has_edit_software']:
        score += 15
    if not metadata['has_exif']:
        score += 5  # stripped metadata is mildly suspicious

    # Pixel stats signals
    if stats['is_overly_uniform']:
        score += 15
    if stats['low_noise_flag']:
        score += 10

    score = min(100, max(0, score))

    if score >= 55:
        label = 'MANIPULATED'
        confidence = min(95, 50 + score)
    elif score <= 25:
        label = 'AUTHENTIC'
        confidence = min(95, 100 - score)
    else:
        label = 'UNCERTAIN'
        confidence = 50 + abs(score - 40)

    confidence = round(min(95, confidence), 2)

    return {
        'label': label,
        'confidence': confidence,
        'analysis_type': 'image',
        'details': {
            'error_level_analysis': ela,
            'metadata': metadata,
            'pixel_statistics': stats,
            'manipulation_score': score,
        },
    }


@app.post('/predict/image')
async def predict_image(file: UploadFile = File(...)):
    """Analyze an uploaded image for signs of manipulation."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, f'Unsupported image type: {file.content_type}. Accepted: JPEG, PNG, WebP, BMP')

    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(400, 'Image too large. Maximum size is 20 MB.')

    try:
        image = Image.open(io.BytesIO(contents))
        result = analyze_image(image)
        return result
    except Exception as e:
        logger.error(f'Image analysis failed: {e}')
        raise HTTPException(500, 'Image analysis failed. Please try a different image.')


# ──────────────────────────────────────────
# VIDEO FAKE DETECTION
# ──────────────────────────────────────────

ALLOWED_VIDEO_TYPES = {'video/mp4', 'video/mpeg', 'video/avi', 'video/webm',
                       'video/quicktime', 'video/x-msvideo', 'video/x-matroska'}
MAX_VIDEO_SIZE = 100 * 1024 * 1024  # 100 MB


def extract_video_frames(video_path: str, max_frames: int = 20):
    """Extract evenly-spaced frames from a video file."""
    import cv2
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError('Could not open video file')

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    duration = total_frames / fps if fps > 0 else 0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    frame_indices = np.linspace(0, total_frames - 1, min(max_frames, total_frames), dtype=int)
    frames = []

    for idx in frame_indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if ret:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frames.append(rgb)

    cap.release()

    return frames, {
        'total_frames': total_frames,
        'fps': round(fps, 2),
        'duration_seconds': round(duration, 2),
        'resolution': {'width': width, 'height': height},
    }


def analyze_frame_consistency(frames: list) -> dict:
    """Check temporal consistency between consecutive frames."""
    if len(frames) < 2:
        return {'consistent': True, 'anomaly_count': 0, 'frame_diffs': []}

    diffs = []
    for i in range(1, len(frames)):
        diff = np.mean(np.abs(frames[i].astype(float) - frames[i - 1].astype(float)))
        diffs.append(round(float(diff), 3))

    mean_diff = np.mean(diffs)
    std_diff = np.std(diffs)

    # Detect anomalous jumps between frames
    anomalies = []
    for i, d in enumerate(diffs):
        if std_diff > 0 and abs(d - mean_diff) > 2.5 * std_diff:
            anomalies.append({'frame_pair': [i, i + 1], 'diff': d})

    return {
        'mean_frame_diff': round(float(mean_diff), 3),
        'std_frame_diff': round(float(std_diff), 3),
        'anomaly_count': len(anomalies),
        'anomalies': anomalies[:5],  # limit to top 5
        'consistent': len(anomalies) == 0,
    }


def analyze_frame_noise(frames: list) -> dict:
    """Analyze noise consistency across frames — spliced content has different noise."""
    noise_levels = []
    for frame in frames:
        gray = np.mean(frame.astype(float), axis=2)
        if gray.shape[0] > 2 and gray.shape[1] > 2:
            lap_var = float(np.var(
                gray[1:-1, 1:-1] * 4
                - gray[:-2, 1:-1]
                - gray[2:, 1:-1]
                - gray[1:-1, :-2]
                - gray[1:-1, 2:]
            ))
        else:
            lap_var = 0
        noise_levels.append(round(lap_var, 2))

    mean_noise = float(np.mean(noise_levels)) if noise_levels else 0
    std_noise = float(np.std(noise_levels)) if noise_levels else 0
    noise_variation = std_noise / mean_noise if mean_noise > 0 else 0

    return {
        'mean_noise': round(mean_noise, 2),
        'noise_std': round(std_noise, 2),
        'noise_variation': round(noise_variation, 4),
        'inconsistent_noise': noise_variation > 0.5,
    }


def analyze_video_frames(frames: list, video_meta: dict) -> dict:
    """Run full video forensic analysis."""
    consistency = analyze_frame_consistency(frames)
    noise = analyze_frame_noise(frames)

    # Run image-level ELA on sampled frames
    frame_ela_scores = []
    for frame in frames[:10]:
        pil_img = Image.fromarray(frame)
        ela = error_level_analysis(pil_img)
        frame_ela_scores.append(ela['suspicious_pixel_ratio'])

    avg_ela = float(np.mean(frame_ela_scores)) if frame_ela_scores else 0

    # Scoring
    score = 0

    # Temporal consistency
    if not consistency['consistent']:
        score += 20
    if consistency['anomaly_count'] > 3:
        score += 10

    # Noise analysis
    if noise['inconsistent_noise']:
        score += 20

    # ELA across frames
    if avg_ela > 0.03:
        score += 15
    if avg_ela > 0.06:
        score += 10

    # Suspicious metadata
    if video_meta['fps'] < 10 or video_meta['fps'] > 120:
        score += 10

    score = min(100, max(0, score))

    if score >= 50:
        label = 'MANIPULATED'
        confidence = min(95, 50 + score)
    elif score <= 20:
        label = 'AUTHENTIC'
        confidence = min(95, 100 - score)
    else:
        label = 'UNCERTAIN'
        confidence = 50 + abs(score - 35)

    confidence = round(min(95, confidence), 2)

    return {
        'label': label,
        'confidence': confidence,
        'analysis_type': 'video',
        'details': {
            'video_info': video_meta,
            'frame_consistency': consistency,
            'noise_analysis': noise,
            'avg_ela_score': round(avg_ela, 5),
            'manipulation_score': score,
            'frames_analyzed': len(frames),
        },
    }


@app.post('/predict/video')
async def predict_video(file: UploadFile = File(...)):
    """Analyze an uploaded video for signs of manipulation."""
    if file.content_type not in ALLOWED_VIDEO_TYPES:
        raise HTTPException(400, f'Unsupported video type: {file.content_type}. Accepted: MP4, AVI, WebM, MOV, MKV')

    contents = await file.read()
    if len(contents) > MAX_VIDEO_SIZE:
        raise HTTPException(400, 'Video too large. Maximum size is 100 MB.')

    try:
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        frames, video_meta = extract_video_frames(tmp_path, max_frames=20)
        os.unlink(tmp_path)

        if len(frames) == 0:
            raise HTTPException(400, 'Could not extract frames from video.')

        result = analyze_video_frames(frames, video_meta)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'Video analysis failed: {e}')
        raise HTTPException(500, 'Video analysis failed. Please try a different video.')


if __name__ == '__main__':
    import uvicorn
    uvicorn.run('app:app', host='0.0.0.0', port=8000, reload=True)
