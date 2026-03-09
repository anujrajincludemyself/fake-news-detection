// TruthLens Extension Configuration
// Edit SERVER_URL to point to your backend if not running locally
const TL_CONFIG = {
  SERVER_URL: 'http://localhost:5000',
  EXTENSION_API_KEY: 'tl-extension-dev-key',
  MIN_CONTENT_LENGTH: 200,    // Minimum chars to trigger analysis
  ANALYSIS_DELAY_MS: 1800,    // Wait for dynamic content to settle
  CACHE_TTL_MS: 15 * 60 * 1000,
};
