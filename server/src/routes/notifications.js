const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  registerToken,
  removeToken,
  sendTestNotification,
  broadcast,
} = require('../controllers/notificationController');
const { protect, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// Register FCM token for the current user
router.post(
  '/token',
  [body('token').notEmpty().withMessage('FCM token is required')],
  registerToken
);

// Remove FCM token (call on logout or when permission revoked)
router.delete('/token', removeToken);

// Send a test notification to yourself (dev helper)
router.post('/test', sendTestNotification);

// Admin: broadcast to all subscribers
router.post(
  '/broadcast',
  authorize('admin'),
  [
    body('title').notEmpty().withMessage('title is required'),
    body('body').notEmpty().withMessage('body is required'),
  ],
  broadcast
);

module.exports = router;
