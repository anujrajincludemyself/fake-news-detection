const admin = require('firebase-admin');
const path = require('path');
const logger = require('../utils/logger');

// Initialize Firebase Admin SDK once
if (!admin.apps.length) {
  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(__dirname, '../../firebase-service-account.json');

  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    logger.info('Firebase Admin SDK initialized');
  } catch (err) {
    logger.error('Failed to initialize Firebase Admin SDK:', err.message);
  }
}

/**
 * Send a push notification to a single FCM token.
 * @param {string} token  - FCM registration token
 * @param {string} title  - Notification title
 * @param {string} body   - Notification body
 * @param {object} data   - Optional key-value data payload
 */
const sendToToken = async (token, title, body, data = {}) => {
  const message = {
    token,
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    ),
    webpush: {
      notification: {
        title,
        body,
        icon: '/logo192.png',
        badge: '/logo192.png',
        requireInteraction: false,
      },
      fcm_options: {
        link: process.env.CLIENT_URL || 'http://localhost:3000',
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    logger.info(`FCM notification sent. MessageId: ${response}`);
    return { success: true, messageId: response };
  } catch (err) {
    logger.warn(`FCM send failed for token: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/**
 * Send a notification to multiple FCM tokens (up to 500).
 * Invalid tokens are returned so the caller can clean them up.
 * @param {string[]} tokens
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
const sendToMultiple = async (tokens, title, body, data = {}) => {
  if (!tokens || tokens.length === 0) return { successCount: 0, failureCount: 0, invalidTokens: [] };

  const message = {
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    ),
    webpush: {
      notification: {
        title,
        body,
        icon: '/logo192.png',
        badge: '/logo192.png',
      },
      fcm_options: {
        link: process.env.CLIENT_URL || 'http://localhost:3000',
      },
    },
    tokens,
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    const invalidTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const code = resp.error?.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(tokens[idx]);
        }
      }
    });
    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokens,
    };
  } catch (err) {
    logger.error('FCM multicast failed:', err.message);
    return { successCount: 0, failureCount: tokens.length, invalidTokens: [] };
  }
};

module.exports = { sendToToken, sendToMultiple };
