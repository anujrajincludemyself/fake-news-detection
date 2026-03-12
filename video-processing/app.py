"""
app.py — Video Processing Microservice
────────────────────────────────────────
Runs on http://localhost:8001 (separate from the ML service on 8000).

Pipeline per request
─────────────────────
  1. Receive video file + user context
  2. Extract 2 representative frames at 320px  (local ffmpeg)
  3. Transcribe audio with faster-whisper      (local GPU/CPU)
  4. Describe content to Groq vision model     (1 API call — transcript + 2 frames)
  5. Fact-check with Groq text model           (1 API call — text only)
  6. Return full structured JSON

Total Groq calls: 2  (down from 7+ in the naive vision-per-frame approach)
"""

import os
import logging
import tempfile
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from frame_extractor import extract_frames, cleanup_frames
from transcriber import transcribe
from groq_checker import describe_video_content, fact_check

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# Allowed video mime types
ALLOWED_MIME_PREFIXES = ("video/",)
MAX_FILE_SIZE_MB = 200


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Video Processing Service starting up…")
    # Pre-warm Whisper model so first request isn't slow
    try:
        from transcriber import _load_model
        _load_model()
    except Exception as e:
        logger.warning(f"Whisper pre-warm failed (will load on first request): {e}")
    yield
    logger.info("Video Processing Service shutting down.")


app = FastAPI(
    title="Video Processing Service",
    description="Local video transcription + Groq fact-checking",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "video-processing"}


@app.post("/process")
async def process_video(
    file: UploadFile = File(..., description="Video file to analyse"),
    context: str = Form("", description="What the user claims the video shows"),
    title: str = Form("", description="Optional title"),
):
    """
    Full video analysis pipeline.

    Returns JSON:
    {
      "title": str,
      "filename": str,
      "context": str,
      "transcript": str,
      "language": str,
      "duration": float,
      "segments": [...],
      "videoSummary": str,
      "frameCount": int,
      "verdict": {
        "label": "REAL"|"FAKE"|"UNCERTAIN",
        "confidence": 0-100,
        "reasoning": str,
        "models": {...}
      },
      "errors": [...]   // non-fatal warnings
    }
    """
    errors = []

    # ── Validate ─────────────────────────────────────────────────────────────
    if not file.content_type or not any(file.content_type.startswith(p) for p in ALLOWED_MIME_PREFIXES):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    video_bytes = await file.read()
    size_mb = len(video_bytes) / 1_048_576
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(status_code=413, detail=f"File too large ({size_mb:.1f} MB). Max is {MAX_FILE_SIZE_MB} MB.")

    logger.info(f"Processing '{file.filename}' ({size_mb:.1f} MB), context='{context[:80]}'")

    # Write video to a temp file (ffmpeg needs a path, not a stream)
    suffix = os.path.splitext(file.filename or ".mp4")[1] or ".mp4"
    tmp_video = tempfile.NamedTemporaryFile(suffix=suffix, delete=False, prefix="vp_in_")
    tmp_video.write(video_bytes)
    tmp_video.close()
    video_path = tmp_video.name

    frames = []
    try:
        # ── Step 1: Extract 2 frames @ 320px ─────────────────────────────────
        logger.info("Step 1/4: Extracting frames…")
        frames = extract_frames(video_path, max_frames=2, scale=320)
        if not frames:
            errors.append("Frame extraction failed — visual analysis will be skipped.")
            logger.warning("No frames extracted.")

        # ── Step 2: Transcribe audio ──────────────────────────────────────────
        logger.info("Step 2/4: Transcribing audio…")
        transcription = transcribe(video_path)
        if transcription.get("error"):
            errors.append(f"Transcription warning: {transcription['error']}")
            logger.warning(f"Transcription issue: {transcription['error']}")

        transcript = transcription.get("transcript", "")
        language = transcription.get("language", "unknown")
        duration = transcription.get("duration", 0.0)
        segments = transcription.get("segments", [])

        logger.info(f"Transcript: {len(transcript)} chars | lang={language} | duration={duration}s")

        # ── Step 3: Groq — describe video content (vision + transcript) ───────
        logger.info("Step 3/4: Groq vision — describing content…")
        video_summary = ""
        try:
            video_summary = describe_video_content(transcript, frames, context)
        except Exception as e:
            errors.append(f"Content description failed: {e}")
            logger.error(f"Groq vision step failed: {e}")
            # Fall back to just the transcript text
            video_summary = transcript[:600] if transcript else "Could not describe video content."

        # ── Step 4: Groq — fact-check verdict ────────────────────────────────
        logger.info("Step 4/4: Groq text — fact-checking…")
        verdict = {"label": "UNCERTAIN", "confidence": 50, "reasoning": "Fact-check step failed.", "models": {}}
        try:
            verdict = fact_check(video_summary, context, transcript)
        except Exception as e:
            errors.append(f"Fact-check failed: {e}")
            logger.error(f"Groq fact-check failed: {e}")

        logger.info(f"Done. Verdict: {verdict['label']} ({verdict['confidence']}%) — {verdict['reasoning']}")

        return {
            "title": title or f"Video Analysis: {file.filename}",
            "filename": file.filename,
            "context": context,
            "transcript": transcript,
            "language": language,
            "duration": duration,
            "segments": segments,
            "videoSummary": video_summary,
            "frameCount": len(frames),
            "verdict": verdict,
            "errors": errors,
        }

    finally:
        # Always clean up temp files
        cleanup_frames(frames)
        try:
            os.unlink(video_path)
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8001))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
