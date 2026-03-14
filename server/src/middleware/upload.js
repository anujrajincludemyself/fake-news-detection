const multer = require('multer');
const path = require('path');

// Store files in memory for forwarding to ML service
const storage = multer.memoryStorage();

const videoFilter = (req, file, cb) => {
  const allowedExt = /mp4|avi|webm|mov|mkv|mpeg/;
  const allowedMime = /mp4|mpeg|avi|webm|quicktime|x-msvideo|x-matroska/;
  const ext = allowedExt.test(path.extname(file.originalname).toLowerCase());
  const mime = allowedMime.test(file.mimetype.split('/')[1]);
  if (ext || mime) {
    cb(null, true);
  } else {
    cb(new Error('Only video files (MP4, AVI, WebM, MOV, MKV) are allowed'), false);
  }
};

const uploadVideo = multer({
  storage,
  fileFilter: videoFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

module.exports = { uploadVideo };
