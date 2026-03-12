/**
 * videoAnalyzer.js
 * ─────────────────
 * Extracts a set of representative frames from a video buffer using ffmpeg,
 * then returns each frame as a JPEG Buffer array.
 *
 * Pipeline used by videoController:
 *   uploadedBuffer → extractFrames() → [Buffer, Buffer, …]
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

/**
 * Write a buffer to a temp file and return the file path.
 * Caller is responsible for cleanup.
 */
function writeTempFile(buffer, ext) {
  const tmp = path.join(os.tmpdir(), `vanalyze_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(tmp, buffer);
  return tmp;
}

/**
 * Extract up to `maxFrames` evenly-spaced frames from a video buffer.
 *
 * @param {Buffer} videoBuffer  - Raw video bytes (from multer memoryStorage)
 * @param {string} mimeType     - e.g. 'video/mp4'
 * @param {number} maxFrames    - How many frames to extract (default 6)
 * @returns {Promise<Array<{buffer: Buffer, index: number, timestamp: string}>>}
 */
async function extractFrames(videoBuffer, mimeType, maxFrames = 6) {
  // Derive a sensible extension from mime type
  const extMap = {
    'video/mp4': '.mp4',
    'video/mpeg': '.mpeg',
    'video/avi': '.avi',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/x-matroska': '.mkv',
  };
  const ext = extMap[mimeType] || '.mp4';

  const videoPath = writeTempFile(videoBuffer, ext);
  const frameDir = path.join(os.tmpdir(), `vframes_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(frameDir);

  try {
    // Get video duration first so we can space frames evenly
    let duration = 30; // fallback seconds
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ]);
      const parsed = parseFloat(stdout.trim());
      if (!isNaN(parsed) && parsed > 0) duration = parsed;
    } catch (_) {
      // ffprobe unavailable or failed — use default
    }

    // Calculate interval so we get maxFrames spread across the video
    const interval = Math.max(1, duration / (maxFrames + 1));

    // Extract frames using ffmpeg fps filter: 1 frame every <interval> seconds
    const fps = 1 / interval;
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-vf', `fps=${fps.toFixed(6)},scale=640:-1`,
      '-vframes', String(maxFrames),
      '-f', 'image2',
      '-q:v', '3',
      path.join(frameDir, 'frame_%03d.jpg'),
    ]);

    // Read extracted frame files
    const files = fs.readdirSync(frameDir)
      .filter((f) => f.endsWith('.jpg'))
      .sort();

    const frames = files.slice(0, maxFrames).map((file, i) => {
      const buf = fs.readFileSync(path.join(frameDir, file));
      // Approximate timestamp for this frame
      const ts = ((i + 1) * interval).toFixed(1);
      return { buffer: buf, index: i + 1, timestamp: `${ts}s` };
    });

    return frames;
  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(videoPath); } catch (_) {}
    try {
      fs.readdirSync(frameDir).forEach((f) => fs.unlinkSync(path.join(frameDir, f)));
      fs.rmdirSync(frameDir);
    } catch (_) {}
  }
}

module.exports = { extractFrames };
