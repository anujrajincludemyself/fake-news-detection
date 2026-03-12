"""
frame_extractor.py
───────────────────
Extracts a small number of representative JPEG frames from a video file
using the system ffmpeg binary. No extra Python packages needed.
"""

import os
import subprocess
import tempfile
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def _get_duration(video_path: str) -> float:
    """Return video duration in seconds via ffprobe. Falls back to 30s."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            capture_output=True, text=True, timeout=15,
        )
        return max(1.0, float(result.stdout.strip()))
    except Exception:
        return 30.0


def extract_frames(video_path: str, max_frames: int = 2, scale: int = 320) -> list[dict]:
    """
    Extract up to `max_frames` evenly-spaced JPEG frames from `video_path`.

    Args:
        video_path: absolute path to the video file
        max_frames:  how many frames to pull (default 2 — minimises Groq vision tokens)
        scale:       resize width in px (height auto-scaled); 320 = ~10x fewer tokens than 640

    Returns:
        list of dicts: [{index, timestamp, path, bytes}]
        `bytes` contains the raw JPEG bytes ready to base64-encode.
    """
    duration = _get_duration(video_path)
    interval = duration / (max_frames + 1)

    frame_dir = tempfile.mkdtemp(prefix="vp_frames_")
    out_pattern = os.path.join(frame_dir, "frame_%02d.jpg")

    fps = 1 / interval
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", f"fps={fps:.6f},scale={scale}:-1",
        "-vframes", str(max_frames),
        "-q:v", "4",
        "-f", "image2",
        out_pattern,
    ]

    try:
        subprocess.run(cmd, capture_output=True, timeout=60, check=True)
    except subprocess.CalledProcessError as e:
        logger.error(f"ffmpeg frame extraction failed: {e.stderr.decode()[:300]}")
        return []
    except subprocess.TimeoutExpired:
        logger.error("ffmpeg timed out during frame extraction")
        return []

    frames = []
    for i, fpath in enumerate(sorted(Path(frame_dir).glob("frame_*.jpg"))):
        ts = round((i + 1) * interval, 1)
        data = fpath.read_bytes()
        frames.append({
            "index": i + 1,
            "timestamp": f"{ts}s",
            "path": str(fpath),
            "bytes": data,
        })
        logger.info(f"Frame {i+1}: {len(data)//1024} KB @ {ts}s")

    return frames


def cleanup_frames(frames: list[dict]) -> None:
    """Delete temp frame files."""
    for f in frames:
        try:
            os.unlink(f["path"])
            os.rmdir(os.path.dirname(f["path"]))
        except Exception:
            pass
