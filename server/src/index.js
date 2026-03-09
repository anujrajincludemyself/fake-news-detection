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

// Connect to database
connectDB();

const app = express();

// Security middleware
app.use(helmet());

// CORS — allow all origins in dev (API key secures the extension endpoint).
// In production lock CLIENT_URL down via environment variable.
app.use(
  cors({
    origin:
      process.env.NODE_ENV === 'production'
        ? (origin, cb) => {
            const allowed = [
              process.env.CLIENT_URL,
              // extensions carry the news-site origin, allow them via keyword
            ].filter(Boolean);
            // allow if no origin, matches whitelist, or is a browser extension
            if (
              !origin ||
              allowed.includes(origin) ||
              /^chrome-extension:\/\//i.test(origin) ||
              /^moz-extension:\/\//i.test(origin)
            ) {
              return cb(null, true);
            }
            cb(null, false); // silently deny, no error thrown
          }
        : '*', // development: allow everything
    credentials: false,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Analysis-specific rate limit
const analysisLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
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
