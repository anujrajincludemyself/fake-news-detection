"""
transcriber.py
───────────────
Local audio transcription using faster-whisper.
Runs on GPU (RTX 3050) when available, falls back to CPU automatically.

Model size recommendation for RTX 3050 4 GB VRAM:
  - "small"  → ~500 MB VRAM, fast, good accuracy
  - "medium" → ~1.5 GB VRAM, slower, better accuracy
  - "large-v3" → ~3.5 GB VRAM, best accuracy (fits in 4 GB if nothing else is loaded)

Set WHISPER_MODEL in .env to override (default: "small").
"""

import os
import subprocess
import tempfile
import logging
from functools import lru_cache

logger = logging.getLogger(__name__)

WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "auto")   # auto | cuda | cpu
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "float16")  # float16 | int8


@lru_cache(maxsize=1)
def _load_model():
    """Load and cache the Whisper model (loaded once at first use)."""
    from faster_whisper import WhisperModel

    device = WHISPER_DEVICE
    compute = WHISPER_COMPUTE

    if device == "auto":
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"

    if device == "cpu":
        compute = "int8"  # float16 is not supported on CPU

    logger.info(f"Loading Whisper model '{WHISPER_MODEL_SIZE}' on {device} ({compute})")
    model = WhisperModel(WHISPER_MODEL_SIZE, device=device, compute_type=compute)
    logger.info("Whisper model loaded.")
    return model


def extract_audio(video_path: str) -> str:
    """
    Use ffmpeg to pull the audio track from a video as a 16 kHz mono WAV.
    Returns the path to the temp WAV file. Caller must delete it.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False, prefix="vp_audio_")
    tmp.close()

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-ar", "16000",    # Whisper expects 16 kHz
        "-ac", "1",        # mono
        "-vn",             # drop video stream
        "-f", "wav",
        tmp.name,
    ]

    try:
        subprocess.run(cmd, capture_output=True, timeout=120, check=True)
    except subprocess.CalledProcessError as e:
        logger.error(f"ffmpeg audio extraction failed: {e.stderr.decode()[:300]}")
        os.unlink(tmp.name)
        return ""
    except subprocess.TimeoutExpired:
        logger.error("ffmpeg timed out during audio extraction")
        os.unlink(tmp.name)
        return ""

    return tmp.name


def transcribe(video_path: str) -> dict:
    """
    Full pipeline: extract audio → transcribe with faster-whisper.

    Returns:
        {
          "transcript": str,        # full text
          "language": str,          # detected language code
          "duration": float,        # audio length in seconds
          "segments": [...],        # [{start, end, text}]
          "error": str | None       # set if something went wrong
        }
    """
    audio_path = ""
    try:
        audio_path = extract_audio(video_path)

        if not audio_path or not os.path.exists(audio_path):
            return {"transcript": "", "language": "unknown", "duration": 0.0,
                    "segments": [], "error": "Audio extraction failed"}

        model = _load_model()
        segments_gen, info = model.transcribe(
            audio_path,
            beam_size=5,
            language=None,          # auto-detect
            condition_on_previous_text=True,
            vad_filter=True,        # skip silent parts
            vad_parameters={"min_silence_duration_ms": 500},
        )

        segments = []
        full_text_parts = []
        for seg in segments_gen:
            segments.append({
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": seg.text.strip(),
            })
            full_text_parts.append(seg.text.strip())

        transcript = " ".join(full_text_parts).strip()
        logger.info(f"Transcription done — {len(transcript)} chars, lang={info.language}")

        return {
            "transcript": transcript,
            "language": info.language,
            "duration": round(info.duration, 1),
            "segments": segments,
            "error": None,
        }

    except Exception as e:
        logger.exception(f"Transcription error: {e}")
        return {
            "transcript": "",
            "language": "unknown",
            "duration": 0.0,
            "segments": [],
            "error": str(e),
        }
    finally:
        if audio_path and os.path.exists(audio_path):
            try:
                os.unlink(audio_path)
            except Exception:
                pass
