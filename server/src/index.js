require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

// Route files
const authRoutes = require('./routes/auth');
const analysisRoutes = require('./routes/analysis');
const mediaRoutes = require('./routes/media');
const extensionRoutes = require('./routes/extension');
const wallRoutes = require('./routes/wall');
const notificationRoutes = require('./routes/notifications');
const videoRoutes = require('./video/videoRoutes');
const networkRoutes = require('./routes/network');

// Connect to database
connectDB();

const app = express();

// Trust the first proxy hop (required on Render, Railway, Heroku, etc.)
// so that express-rate-limit can correctly read the client IP from X-Forwarded-For.
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS — allow all origins in dev (API key secures the extension endpoint).
// In production lock CLIENT_URL down via environment variable.
// Build the allowed-origins list for production.
// CLIENT_URL can be a comma-separated list of origins (e.g. for preview deploys).
const PRODUCTION_ORIGINS = [
  // Always allow the primary Vercel frontend
  'https://fake-news-detection-seven-delta.vercel.app',
  // Allow any extra origins supplied at deploy-time
  ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',').map((u) => u.trim()) : []),
].filter(Boolean);

app.use(
  cors({
    origin:
      process.env.NODE_ENV === 'production'
        ? (origin, cb) => {
            // Allow server-to-server (no Origin), whitelisted origins, or browser extensions
            if (
              !origin ||
              PRODUCTION_ORIGINS.includes(origin) ||
              /^chrome-extension:\/\//i.test(origin) ||
              /^moz-extension:\/\//i.test(origin)
            ) {
              return cb(null, true);
            }
            cb(new Error(`CORS: origin ${origin} not allowed`));
          }
        : '*', // development: allow everything
    credentials: false,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  trustProxy: true, // Required for Render, Railway, Heroku (respects X-Forwarded-For)
  message: { success: false, message: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Analysis-specific rate limit
const analysisLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  trustProxy: true, // Required for Render, Railway, Heroku (respects X-Forwarded-For)
  message: { success: false, message: 'Too many analysis requests, please slow down' },
});
app.use('/api/analysis', analysisLimiter);

// Body parser — 1 MB is ample for JSON (media uploads use multipart/form-data via multer)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'FakeNews Detective API is running',
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/extension', extensionRoutes);
app.use('/api/wall', wallRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/network', networkRoutes);

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});

module.exports = app;
