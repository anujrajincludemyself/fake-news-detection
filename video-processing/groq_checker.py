"""
groq_checker.py
────────────────
Sends the video transcript (from Whisper) + up to 2 frames (from ffmpeg)
to Groq and returns a structured fact-check verdict.

Groq call budget per video:
  - 1× vision call  (llama-4-scout)  — transcript + 2 small frames
  - 1× text  call  (llama-3.3-70b)  — final verdict from synthesis

That's 2 calls total instead of 7+, saving ~70% quota.
"""

import os
import base64
import json
import logging
import httpx

logger = logging.getLogger(__name__)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
TEXT_MODEL = "llama-3.3-70b-versatile"


def _parse_json(raw: str) -> dict:
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        import re
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if m:
            return json.loads(m.group(0))
        raise ValueError("No JSON object found in Groq response")


def _headers() -> dict:
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set in environment")
    return {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }


def _to_data_url(frame_bytes: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(frame_bytes).decode()


# ── Stage 1: Describe visual content + transcript together ────────────────────
def describe_video_content(
    transcript: str,
    frames: list[dict],
    user_context: str,
) -> str:
    """
    Single vision call: sends transcript text + up to 2 frames.
    Returns a plain-text summary of what the video contains.
    """
    context_line = (
        f'The user claims this video is about: "{user_context}"'
        if user_context
        else "No specific context was provided about this video."
    )

    transcript_block = (
        f'Audio transcript:\n"""\n{transcript[:3000]}\n"""'
        if transcript
        else "No audio transcript available (silent video or transcription failed)."
    )

    # Build multimodal content list
    content = [
        {
            "type": "text",
            "text": (
                f"{context_line}\n\n"
                f"{transcript_block}\n\n"
                "Below are representative frames from the video. "
                "Describe what the video is about in 3-5 factual sentences — "
                "covering who appears, what is happening, what is being said, and the setting. "
                "Do NOT judge whether it is real or fake yet."
            ),
        }
    ]

    for frame in frames[:2]:  # hard cap at 2 frames
        content.append({
            "type": "image_url",
            "image_url": {"url": _to_data_url(frame["bytes"])},
        })

    payload = {
        "model": VISION_MODEL,
        "temperature": 0.15,
        "max_tokens": 400,
        "messages": [{"role": "user", "content": content}],
    }

    with httpx.Client(timeout=60) as client:
        resp = client.post(GROQ_URL, headers=_headers(), json=payload)

    if resp.status_code == 429:
        raise RuntimeError("Groq vision rate limit hit — try again in a minute")
    resp.raise_for_status()

    summary = resp.json()["choices"][0]["message"]["content"].strip()
    logger.info(f"[Stage-1] Video summary ({len(summary)} chars): {summary[:120]}…")
    return summary


# ── Stage 2: Fact-check the summary vs the user's context/claim ───────────────
def fact_check(video_summary: str, user_context: str) -> dict:
    """
    Text-only call: given the rich video description, produce a verdict.
    Returns {label, confidence, reasoning}.
    """
    context_line = (
        f'The video is being shared with this claim: "{user_context}"'
        if user_context
        else "No specific claim was provided. Assess whether the video content appears authentic and internally consistent."
    )

    payload = {
        "model": TEXT_MODEL,
        "temperature": 0.1,
        "max_tokens": 256,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a video fact-checking AI.\n"
                    "Rules:\n"
                    "- REAL: video content is consistent with the claim and nothing visible or audible contradicts it\n"
                    "- FAKE: video content directly contradicts a key fact in the claim\n"
                    "- UNCERTAIN: too vague or unrelated to make a firm determination\n"
                    "Respond ONLY with raw JSON, no markdown:\n"
                    '{"label":"REAL"|"FAKE"|"UNCERTAIN","confidence":<0-100>,"reasoning":"<one sentence>"}'
                ),
            },
            {
                "role": "user",
                "content": f"Video content description:\n\"{video_summary}\"\n\n{context_line}",
            },
        ],
    }

    with httpx.Client(timeout=30) as client:
        resp = client.post(GROQ_URL, headers=_headers(), json=payload)

    if resp.status_code == 429:
        raise RuntimeError("Groq text rate limit hit — try again in a minute")
    resp.raise_for_status()

    raw = resp.json()["choices"][0]["message"]["content"]
    logger.info(f"[Stage-2] Raw verdict: {raw}")
    parsed = _parse_json(raw)

    label = str(parsed.get("label", "UNCERTAIN")).upper()
    if label not in ("REAL", "FAKE", "UNCERTAIN"):
        label = "UNCERTAIN"

    return {
        "label": label,
        "confidence": min(100, max(0, int(parsed.get("confidence", 50)))),
        "reasoning": parsed.get("reasoning", ""),
        "models": {"vision": VISION_MODEL, "text": TEXT_MODEL},
    }
