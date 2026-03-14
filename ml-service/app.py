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
import shutil
import subprocess
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

import joblib
import nltk
import numpy as np
from fastapi import FastAPI, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from nltk.corpus import stopwords
from nltk.stem import PorterStemmer
from features import StructuralFeatureExtractor
from PIL import Image, ImageChops, ImageEnhance, ExifTags

load_dotenv()

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
yolo_model = None
mobilenet_model = None
mobilenet_transform = None
visual_deepfake_model = None
visual_transform = None
voice_encoder = None
whisper_model = None


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
            try:
                struct_extractor = joblib.load(struct_path)
                logger.info('Trained model + structural extractor loaded successfully.')
            except Exception as e:
                logger.warning(f'Could not load structural extractor ({e}). Retrain the model.')
        else:
            logger.info('Trained model loaded (no structural extractor — old model).')
        return True
    else:
        logger.warning('No trained model found. Service will use heuristic analysis.')
        logger.warning('Run train_model.py first to train the ML model.')
        return False


def load_yolo_model():
    """Load YOLOv8n pretrained model for object detection in video analysis."""
    global yolo_model
    try:
        from ultralytics import YOLO
        local_path = os.path.join(MODELS_DIR, 'yolov8n.pt')
        model_path = local_path if os.path.exists(local_path) else 'yolov8n.pt'
        yolo_model = YOLO(model_path)
        logger.info(f'YOLOv8n model loaded from {model_path}.')
    except Exception as e:
        logger.warning(f'Could not load YOLOv8n model ({e}). Object-detection layer will be skipped.')


def load_mobilenet_model():
    """Load MobileNetV2 pretrained on ImageNet for deep image feature analysis."""
    global mobilenet_model, mobilenet_transform
    try:
        import torch
        import torchvision.models as tv_models
        import torchvision.transforms as transforms

        local_path = os.path.join(MODELS_DIR, 'mobilenet_v2.pth')
        mobilenet_model = tv_models.mobilenet_v2(weights=None)
        if os.path.exists(local_path):
            mobilenet_model.load_state_dict(torch.load(local_path, map_location='cpu'))
            logger.info(f'MobileNetV2 weights loaded from {local_path}.')
        else:
            # Fallback: download from PyTorch Hub (requires internet)
            logger.warning('mobilenet_v2.pth not found in models/. Downloading from PyTorch Hub...')
            state_dict = tv_models.MobileNet_V2_Weights.IMAGENET1K_V1.get_state_dict(progress=True)
            mobilenet_model.load_state_dict(state_dict)
        mobilenet_model.eval()

        mobilenet_transform = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                 std=[0.229, 0.224, 0.225]),
        ])
        logger.info('MobileNetV2 model loaded successfully.')
    except Exception as e:
        logger.warning(f'Could not load MobileNetV2 ({e}). Deep-feature image analysis will be skipped.')


def load_visual_deepfake_model():
    """Load optional EfficientNet deepfake classifier from models/."""
    global visual_deepfake_model, visual_transform
    try:
        import torch
        import torchvision.models as tv_models
        import torchvision.transforms as transforms

        candidate_paths = [
            os.path.join(MODELS_DIR, 'deepfake_model.pth'),
            os.path.join(MODELS_DIR, 'efficientnet_deepfake.pth'),
        ]
        model_path = next((p for p in candidate_paths if os.path.exists(p)), None)
        if not model_path:
            logger.info('No EfficientNet deepfake model found in models/. Visual risk will use forensic fallback.')
            return

        loaded = torch.load(model_path, map_location='cpu')
        if hasattr(loaded, 'eval'):
            visual_deepfake_model = loaded
        else:
            model = tv_models.efficientnet_b0(weights=None)
            model.classifier[1] = torch.nn.Linear(model.classifier[1].in_features, 1)
            model.load_state_dict(loaded, strict=False)
            visual_deepfake_model = model

        visual_deepfake_model.eval()
        visual_transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])
        logger.info(f'Visual deepfake model loaded from {model_path}.')
    except Exception as e:
        logger.warning(f'Could not load visual deepfake model ({e}). Forensic fallback will be used.')


def load_voice_encoder():
    """Load Resemblyzer encoder for voice authenticity checks."""
    global voice_encoder
    try:
        from resemblyzer import VoiceEncoder
        voice_encoder = VoiceEncoder()
        logger.info('Resemblyzer voice encoder loaded.')
    except Exception as e:
        logger.warning(f'Could not load Resemblyzer voice encoder ({e}). Voice scoring will fallback to unknown risk.')


def load_whisper_model():
    """Load faster-whisper model used for speech-to-text."""
    global whisper_model
    try:
        from faster_whisper import WhisperModel
        model_size = os.getenv('WHISPER_MODEL_SIZE', 'base')
        whisper_model = WhisperModel(model_size, device='cpu', compute_type='int8')
        logger.info(f'faster-whisper model loaded ({model_size}).')
    except Exception as e:
        logger.warning(f'Could not load faster-whisper model ({e}). Transcription will be unavailable.')


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    load_yolo_model()
    load_mobilenet_model()
    load_visual_deepfake_model()
    load_voice_encoder()
    load_whisper_model()
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
        'yolo_loaded': yolo_model is not None,
        'mobilenet_loaded': mobilenet_model is not None,
        'visual_deepfake_model_loaded': visual_deepfake_model is not None,
        'voice_encoder_loaded': voice_encoder is not None,
        'whisper_loaded': whisper_model is not None,
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


def mobilenet_image_analysis(image: Image.Image) -> dict:
    """
    Use pretrained MobileNetV2 (ImageNet weights) to extract deep-feature signals
    for image authenticity assessment.

    Signals produced
    ─────────────────
    • prediction_entropy   — softmax entropy over 1000 classes, normalised to [0,1].
                             Authentic photos tend to produce moderate entropy; unusual
                             or AI-generated images often yield higher entropy because
                             the network is uncertain about their content.
    • top_class_confidence — confidence of the single most likely ImageNet class.
    • feature_std          — standard deviation of the penultimate-layer feature vector.
                             Synthetically generated images sometimes show unusually low
                             feature diversity.
    • crop_entropy_variation — std of entropy values computed across four random 224×224
                               crops. Composited/spliced images produce inconsistent
                               regional predictions, raising this value.
    """
    if mobilenet_model is None:
        return {'available': False}

    import random
    import torch
    import torch.nn.functional as F

    try:
        img_rgb = image.convert('RGB')
        w, h = img_rgb.size

        # ── Full-image forward pass ──────────────────────────────
        tensor = mobilenet_transform(img_rgb).unsqueeze(0)
        with torch.no_grad():
            logits = mobilenet_model(tensor)
            probs = F.softmax(logits, dim=1)[0].numpy()

        # Prediction entropy (nats), normalised by ln(1000)
        _max_entropy = float(np.log(1000))
        entropy = float(-np.sum(probs * np.log(probs + 1e-9)))
        norm_entropy = entropy / _max_entropy

        top_confidence = float(np.max(probs))
        top5_confidence = float(np.sum(np.sort(probs)[-5:]))

        # ── Feature vector (penultimate layer) ───────────────────
        with torch.no_grad():
            features = mobilenet_model.features(tensor)
            feat_vec = F.adaptive_avg_pool2d(features, (1, 1)).squeeze().numpy()

        feature_std = float(np.std(feat_vec))

        # ── Multi-crop entropy consistency ───────────────────────
        crop_size = 224
        crop_entropies = []
        for _ in range(4):
            if w > crop_size and h > crop_size:
                x = random.randint(0, w - crop_size)
                y = random.randint(0, h - crop_size)
                crop = img_rgb.crop((x, y, x + crop_size, y + crop_size))
            else:
                crop = img_rgb

            crop_tensor = mobilenet_transform(crop).unsqueeze(0)
            with torch.no_grad():
                crop_logits = mobilenet_model(crop_tensor)
                crop_probs = F.softmax(crop_logits, dim=1)[0].numpy()
            crop_ent = float(-np.sum(crop_probs * np.log(crop_probs + 1e-9))) / _max_entropy
            crop_entropies.append(crop_ent)

        crop_entropy_variation = float(np.std(crop_entropies))

        return {
            'available': True,
            'prediction_entropy': round(entropy, 4),
            'normalized_entropy': round(norm_entropy, 4),
            'top_class_confidence': round(top_confidence, 4),
            'top5_confidence': round(top5_confidence, 4),
            'feature_std': round(feature_std, 4),
            'crop_entropy_variation': round(crop_entropy_variation, 4),
            # Interpretation flags (used by scoring)
            'high_entropy': norm_entropy > 0.75,
            'low_feature_diversity': feature_std < 0.10,
            'inconsistent_crops': crop_entropy_variation > 0.05,
        }
    except Exception as e:
        logger.error(f'MobileNetV2 analysis failed: {e}')
        return {'available': False, 'error': str(e)}


def analyze_image(image: Image.Image) -> dict:
    """Run full image forensic analysis and produce a verdict."""
    ela = error_level_analysis(image)
    metadata = analyze_metadata(image)
    stats = pixel_statistics(image)
    mobilenet = mobilenet_image_analysis(image)

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

    # MobileNetV2 deep-feature signals
    if mobilenet.get('available'):
        if mobilenet['inconsistent_crops']:
            score += 15  # different regions yield inconsistent predictions → compositing
        if mobilenet['low_feature_diversity']:
            score += 10  # unusually homogeneous features → potentially synthetic
        if mobilenet['high_entropy']:
            score += 10  # image content is unusual/ambiguous for a real photo

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
            'mobilenet_analysis': mobilenet,
            'manipulation_score': score,
        },
    }

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


def analyze_yolo_detections(frames: list) -> dict:
    """
    Run YOLOv8n object detection across frames and flag temporal inconsistencies.

    Signals used:
    - High object-count variation across frames (sudden appearances/removals)
    - Classes that exist in isolated frames only (splice indicator)
    - Implausible person bounding-box aspect ratios (deepfake / compositing)
    """
    if yolo_model is None:
        return {'available': False}

    frame_detections = []
    for frame in frames:
        pil_img = Image.fromarray(frame)
        results = yolo_model(pil_img, verbose=False)[0]
        boxes = results.boxes
        detections = []
        if boxes is not None and len(boxes):
            for box in boxes:
                cls_id = int(box.cls[0])
                cls_name = yolo_model.names[cls_id]
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                w = x2 - x1
                h = y2 - y1
                detections.append({
                    'class': cls_name,
                    'confidence': round(conf, 3),
                    'aspect_ratio': round(w / h if h > 0 else 0.0, 3),
                })
        frame_detections.append(detections)

    # --- object-count variation ---
    object_counts = [len(d) for d in frame_detections]
    mean_count = float(np.mean(object_counts)) if object_counts else 0
    std_count = float(np.std(object_counts)) if object_counts else 0
    count_variation = std_count / mean_count if mean_count > 0 else 0

    # --- class-set consistency: classes isolated to a single frame ---
    classes_per_frame = [set(d['class'] for d in det) for det in frame_detections]
    class_anomalies = 0
    for i in range(1, len(classes_per_frame) - 1):
        isolated = classes_per_frame[i] - classes_per_frame[i - 1] - classes_per_frame[i + 1]
        class_anomalies += len(isolated)

    # --- person aspect-ratio check (normal range ~0.35–0.75 for standing person) ---
    person_anomalies = 0
    for det in frame_detections:
        for d in det:
            if d['class'] == 'person':
                ar = d['aspect_ratio']
                if ar < 0.2 or ar > 1.5:
                    person_anomalies += 1

    return {
        'available': True,
        'frames_analyzed': len(frames),
        'object_count_mean': round(mean_count, 2),
        'object_count_std': round(std_count, 2),
        'count_variation': round(count_variation, 4),
        'class_anomalies': class_anomalies,
        'person_anomalies': person_anomalies,
        'high_count_variation': count_variation > 0.6,
        'has_class_anomalies': class_anomalies > 2,
        'has_person_anomalies': person_anomalies > 0,
    }


def analyze_video_frames(frames: list, video_meta: dict) -> dict:
    """Run full video forensic analysis including YOLOv8n object consistency."""
    consistency = analyze_frame_consistency(frames)
    noise = analyze_frame_noise(frames)
    yolo = analyze_yolo_detections(frames)

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

    # YOLOv8n object-detection signals
    if yolo.get('available'):
        if yolo['high_count_variation']:
            score += 15  # objects appear/disappear suddenly
        if yolo['has_class_anomalies']:
            score += 20  # object classes isolated to single frames
        if yolo['has_person_anomalies']:
            score += 10  # implausible person proportions

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
            'yolo_object_analysis': yolo,
            'avg_ela_score': round(avg_ela, 5),
            'manipulation_score': score,
            'frames_analyzed': len(frames),
        },
    }


def require_ffmpeg() -> None:
    """Ensure ffmpeg is installed and available on PATH."""
    ffmpeg_path = os.getenv('FFMPEG_PATH', '').strip()
    if ffmpeg_path and os.path.exists(ffmpeg_path):
        return

    if shutil.which('ffmpeg') is None:
        raise HTTPException(status_code=500, detail='ffmpeg is not installed or not available on PATH.')


def get_ffmpeg_bin() -> str:
    """Return ffmpeg executable name/path."""
    ffmpeg_path = os.getenv('FFMPEG_PATH', '').strip()
    if ffmpeg_path and os.path.exists(ffmpeg_path):
        return ffmpeg_path
    return 'ffmpeg'


def extract_frames_with_ffmpeg(video_path: str, fps: int = 1) -> tuple[list[str], str]:
    """Extract 1 frame per second by default and return frame paths + temp dir."""
    require_ffmpeg()
    ffmpeg_bin = get_ffmpeg_bin()
    frame_dir = tempfile.mkdtemp(prefix='ml_frames_')
    out_pattern = os.path.join(frame_dir, 'frame_%04d.jpg')

    cmd = [
        ffmpeg_bin, '-y',
        '-i', video_path,
        '-vf', f'fps={fps}',
        '-q:v', '2',
        out_pattern,
    ]
    subprocess.run(cmd, capture_output=True, check=True)

    frame_paths = sorted(str(p) for p in Path(frame_dir).glob('frame_*.jpg'))
    return frame_paths, frame_dir


def extract_audio_with_ffmpeg(video_path: str) -> str:
    """Extract mono 16 kHz WAV audio from a video file."""
    require_ffmpeg()
    ffmpeg_bin = get_ffmpeg_bin()
    tmp_audio = tempfile.NamedTemporaryFile(suffix='.wav', delete=False, prefix='ml_audio_')
    tmp_audio.close()

    cmd = [
        ffmpeg_bin, '-y',
        '-i', video_path,
        '-q:a', '0',
        '-map', 'a',
        '-ar', '16000',
        '-ac', '1',
        tmp_audio.name,
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    return tmp_audio.name


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity in [0, 1] for embedding vectors."""
    denom = (np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    value = float(np.dot(a, b) / denom)
    return max(0.0, min(1.0, value))


def score_visual_deepfake(frame_paths: list[str]) -> dict:
    """Compute visual deepfake risk from frames."""
    if not frame_paths:
        return {'risk': 50.0, 'method': 'no_frames', 'fake_probability': 0.5}

    if visual_deepfake_model is not None and visual_transform is not None:
        try:
            import torch

            probs = []
            for path in frame_paths:
                with Image.open(path) as img:
                    input_tensor = visual_transform(img.convert('RGB')).unsqueeze(0)
                with torch.no_grad():
                    pred = visual_deepfake_model(input_tensor)
                if isinstance(pred, (tuple, list)):
                    pred = pred[0]
                if getattr(pred, 'ndim', 0) == 2 and pred.shape[1] > 1:
                    fake_prob = float(torch.softmax(pred, dim=1)[0, 1].item())
                else:
                    fake_prob = float(torch.sigmoid(pred.reshape(-1)[0]).item())
                probs.append(fake_prob)

            fake_probability = float(np.mean(probs)) if probs else 0.5
            return {
                'risk': round(fake_probability * 100.0, 2),
                'method': 'efficientnet_deepfake_model',
                'fake_probability': round(fake_probability, 4),
                'frames_scored': len(probs),
            }
        except Exception as e:
            logger.warning(f'Visual model scoring failed ({e}). Falling back to forensic scoring.')

    ela_scores = []
    for path in frame_paths[:30]:
        try:
            with Image.open(path) as img:
                ela = error_level_analysis(img)
                ela_scores.append(float(ela['suspicious_pixel_ratio']))
        except Exception:
            continue

    avg_ela = float(np.mean(ela_scores)) if ela_scores else 0.03
    risk = min(100.0, max(0.0, avg_ela * 1400.0))
    return {
        'risk': round(risk, 2),
        'method': 'forensic_ela_fallback',
        'avg_suspicious_pixel_ratio': round(avg_ela, 5),
    }


def score_voice_deepfake(audio_path: str, reference_audio_paths: Optional[list[str]] = None) -> dict:
    """Compute voice deepfake risk using Resemblyzer embeddings."""
    reference_audio_paths = reference_audio_paths or []

    if voice_encoder is None:
        return {
            'risk': 50.0,
            'method': 'unavailable',
            'note': 'Resemblyzer is not installed or failed to load.',
        }

    try:
        from resemblyzer import preprocess_wav

        wav = preprocess_wav(Path(audio_path))
        utt_emb, partial_embs, _ = voice_encoder.embed_utterance(wav, return_partials=True, rate=2)

        if reference_audio_paths:
            similarities = []
            for ref_path in reference_audio_paths:
                ref_wav = preprocess_wav(Path(ref_path))
                ref_emb = voice_encoder.embed_utterance(ref_wav)
                similarities.append(cosine_similarity(utt_emb, ref_emb))

            max_sim = max(similarities) if similarities else 0.0
            risk = (1.0 - max_sim) * 100.0
            return {
                'risk': round(max(0.0, min(100.0, risk)), 2),
                'method': 'reference_similarity',
                'max_similarity': round(max_sim, 4),
                'reference_count': len(reference_audio_paths),
            }

        # No reference voice available: use temporal consistency heuristic.
        # Very uniform partial embeddings can indicate synthetic voice generation artifacts.
        similarities = [cosine_similarity(partial, utt_emb) for partial in partial_embs] if len(partial_embs) else []
        mean_sim = float(np.mean(similarities)) if similarities else 0.95
        std_sim = float(np.std(similarities)) if similarities else 0.01

        risk = 45.0 + (mean_sim - 0.93) * 140.0 - std_sim * 120.0
        risk = max(0.0, min(100.0, risk))

        return {
            'risk': round(risk, 2),
            'method': 'embedding_consistency_heuristic',
            'mean_similarity': round(mean_sim, 4),
            'similarity_std': round(std_sim, 4),
            'note': 'Upload reference voices for stronger verification.',
        }
    except Exception as e:
        logger.error(f'Voice deepfake scoring failed: {e}')
        return {
            'risk': 50.0,
            'method': 'error',
            'note': str(e),
        }


def transcribe_audio_with_whisper(audio_path: str) -> dict:
    """Transcribe audio to text using faster-whisper."""
    if whisper_model is None:
        return {
            'transcript': '',
            'language': 'unknown',
            'segments': [],
            'note': 'Whisper model unavailable',
        }

    segments_gen, info = whisper_model.transcribe(audio_path, beam_size=5, vad_filter=True)
    segments = []
    transcript_parts = []

    for seg in segments_gen:
        text = seg.text.strip()
        segments.append({'start': round(seg.start, 2), 'end': round(seg.end, 2), 'text': text})
        transcript_parts.append(text)

    return {
        'transcript': ' '.join(transcript_parts).strip(),
        'language': getattr(info, 'language', 'unknown'),
        'segments': segments,
    }


def map_fact_rating_to_risk(textual_rating: str) -> float:
    """Map textual claim rating to a numeric fake-news risk."""
    rating = (textual_rating or '').lower()

    high = ['false', 'pants on fire', 'fake', 'mostly false', 'incorrect', 'misleading']
    medium = ['half true', 'mixture', 'partly false', 'partly true', 'unproven']
    low = ['true', 'mostly true', 'correct', 'accurate']

    if any(token in rating for token in high):
        return 85.0
    if any(token in rating for token in medium):
        return 55.0
    if any(token in rating for token in low):
        return 20.0
    return 50.0


async def fact_check_with_google_api(query_text: str) -> dict:
    """Call Google Fact Check Tools API and convert reviews into a risk score."""
    api_key = os.getenv('GOOGLE_FACT_CHECK_API_KEY', '').strip()
    if not query_text.strip():
        return {'risk': 50.0, 'claims': [], 'note': 'No text available for fact check'}

    if not api_key:
        return {
            'risk': 50.0,
            'claims': [],
            'note': 'GOOGLE_FACT_CHECK_API_KEY is not set',
        }

    try:
        import httpx
    except Exception:
        return {
            'risk': 50.0,
            'claims': [],
            'note': 'httpx package is not installed',
        }

    url = 'https://factchecktools.googleapis.com/v1alpha1/claims:search'
    params = {
        'query': query_text[:800],
        'languageCode': 'en-US',
        'pageSize': 10,
        'key': api_key,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
        payload = response.json()
    except Exception as e:
        logger.error(f'Google fact-check API failed: {e}')
        return {'risk': 50.0, 'claims': [], 'note': f'Fact-check API error: {e}'}

    claims = payload.get('claims', [])
    simplified_claims = []
    risks = []

    for claim in claims:
        claim_text = claim.get('text', '')
        reviews = claim.get('claimReview', [])
        simplified_reviews = []

        for review in reviews:
            textual_rating = review.get('textualRating', '')
            publisher = (review.get('publisher') or {}).get('name', 'Unknown')
            risk = map_fact_rating_to_risk(textual_rating)
            risks.append(risk)
            simplified_reviews.append({
                'publisher': publisher,
                'textualRating': textual_rating,
                'risk': risk,
                'url': review.get('url', ''),
            })

        simplified_claims.append({
            'text': claim_text,
            'claimant': claim.get('claimant', ''),
            'reviews': simplified_reviews,
        })

    avg_risk = float(np.mean(risks)) if risks else 50.0
    return {
        'risk': round(avg_risk, 2),
        'claims': simplified_claims,
        'note': 'ok' if claims else 'No fact-check claims found for the transcript/context',
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


@app.post('/predict/video/pipeline')
async def predict_video_pipeline(
    file: UploadFile = File(...),
    context: str = Form(''),
    reference_voices: list[UploadFile] = File(default=[]),
):
    """
    End-to-end multimodal pipeline:
    1) video -> frames (visual deepfake risk)
    2) video -> audio (voice deepfake risk)
    3) audio -> text (Whisper)
    4) transcript/context -> Google Fact Check API
    5) weighted final authenticity score
    """
    if not file.content_type or not file.content_type.startswith('video/'):
        raise HTTPException(status_code=400, detail=f'Unsupported file type: {file.content_type}')

    content = await file.read()
    if len(content) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=413, detail='Video too large. Maximum size is 100 MB.')

    suffix = os.path.splitext(file.filename or '.mp4')[1] or '.mp4'
    tmp_video = tempfile.NamedTemporaryFile(suffix=suffix, delete=False, prefix='pipeline_video_')
    tmp_video.write(content)
    tmp_video.close()

    frame_paths: list[str] = []
    frame_dir = ''
    audio_path = ''
    reference_paths: list[str] = []

    try:
        try:
            frame_paths, frame_dir = extract_frames_with_ffmpeg(tmp_video.name, fps=1)
        except subprocess.CalledProcessError as e:
            msg = (e.stderr or b'').decode(errors='ignore')[:200]
            raise HTTPException(status_code=500, detail=f'Frame extraction failed: {msg}')

        if not frame_paths:
            raise HTTPException(status_code=400, detail='No frames extracted from video')

        try:
            audio_path = extract_audio_with_ffmpeg(tmp_video.name)
        except subprocess.CalledProcessError as e:
            msg = (e.stderr or b'').decode(errors='ignore')[:200]
            raise HTTPException(status_code=500, detail=f'Audio extraction failed: {msg}')

        for ref in reference_voices:
            ref_bytes = await ref.read()
            if not ref_bytes:
                continue
            tmp_ref = tempfile.NamedTemporaryFile(suffix='.wav', delete=False, prefix='pipeline_ref_')
            tmp_ref.write(ref_bytes)
            tmp_ref.close()
            reference_paths.append(tmp_ref.name)

        visual = score_visual_deepfake(frame_paths)
        voice = score_voice_deepfake(audio_path, reference_paths)
        transcription = transcribe_audio_with_whisper(audio_path)

        transcript_text = transcription.get('transcript', '')
        fact_input = (context.strip() + ' ' + transcript_text.strip()).strip() if context else transcript_text
        fact_check = await fact_check_with_google_api(fact_input)

        visual_risk = float(visual.get('risk', 50.0))
        voice_risk = float(voice.get('risk', 50.0))
        fact_risk = float(fact_check.get('risk', 50.0))

        final_risk = 0.4 * visual_risk + 0.25 * voice_risk + 0.35 * fact_risk
        authenticity = max(0.0, min(100.0, 100.0 - final_risk))

        return {
            'videoAuthenticityScore': round(authenticity, 2),
            'visualDeepfakeRisk': round(visual_risk, 2),
            'voiceDeepfakeRisk': round(voice_risk, 2),
            'factCheckRisk': round(fact_risk, 2),
            'finalRisk': round(final_risk, 2),
            'summary': {
                'Video Authenticity Score': f"{authenticity:.2f}%",
                'Visual Deepfake Risk': f"{visual_risk:.2f}%",
                'Voice Deepfake Risk': f"{voice_risk:.2f}%",
                'Fact-check Risk': f"{fact_risk:.2f}%",
            },
            'transcript': transcript_text,
            'language': transcription.get('language', 'unknown'),
            'segments': transcription.get('segments', []),
            'factCheckClaims': fact_check.get('claims', []),
            'debug': {
                'visual': visual,
                'voice': voice,
                'fact_check_note': fact_check.get('note', ''),
                'framesExtracted': len(frame_paths),
                'referenceVoicesUsed': len(reference_paths),
            },
        }
    finally:
        if os.path.exists(tmp_video.name):
            try:
                os.unlink(tmp_video.name)
            except Exception:
                pass

        if audio_path and os.path.exists(audio_path):
            try:
                os.unlink(audio_path)
            except Exception:
                pass

        for path in reference_paths:
            if os.path.exists(path):
                try:
                    os.unlink(path)
                except Exception:
                    pass

        for frame_path in frame_paths:
            if os.path.exists(frame_path):
                try:
                    os.unlink(frame_path)
                except Exception:
                    pass

        if frame_dir and os.path.isdir(frame_dir):
            try:
                os.rmdir(frame_dir)
            except Exception:
                pass


if __name__ == '__main__':
    import uvicorn
    uvicorn.run('app:app', host='0.0.0.0', port=8000, reload=True)
