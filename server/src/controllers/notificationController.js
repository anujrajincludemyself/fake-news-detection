const User = require('../models/User');
const { sendToToken, sendToMultiple } = require('../services/firebaseService');
const logger = require('../utils/logger');

/**
 * @desc  Register or update the FCM token for the authenticated user
 * @route POST /api/notifications/token
 * @access Private
 */
exports.registerToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, message: 'FCM token is required' });
    }

    // Pull the user with fcmTokens (selected: false by default)
    const user = await User.findById(req.user.id).select('+fcmTokens');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Add token only if not already stored (cap at 5 devices per user)
    if (!user.fcmTokens.includes(token)) {
      if (user.fcmTokens.length >= 5) {
        user.fcmTokens.shift(); // remove oldest
      }
      user.fcmTokens.push(token);
      await user.save();
    }

    res.status(200).json({ success: true, message: 'FCM token registered' });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc  Remove an FCM token (e.g. on logout or permission revoke)
 * @route DELETE /api/notifications/token
 * @access Private
 */
exports.removeToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: 'FCM token is required' });
    }

    await User.findByIdAndUpdate(req.user.id, {
      $pull: { fcmTokens: token },
    });

    res.status(200).json({ success: true, message: 'FCM token removed' });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc  Send a test notification to the current user (development helper)
 * @route POST /api/notifications/test
 * @access Private
 */
exports.sendTestNotification = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('+fcmTokens');
    if (!user || user.fcmTokens.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No FCM tokens registered for this user',
      });
    }

    const results = await sendToMultiple(
      user.fcmTokens,
      'Tasdeeq - Test Notification',
      'Push notifications are working correctly!',
      { type: 'test' }
    );

    // Clean up any tokens that are no longer valid
    if (results.invalidTokens.length > 0) {
      await User.findByIdAndUpdate(user._id, {
        $pull: { fcmTokens: { $in: results.invalidTokens } },
      });
    }

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc  Broadcast a notification to all users (admin only)
 * @route POST /api/notifications/broadcast
 * @access Private/Admin
 */
exports.broadcast = async (req, res, next) => {
  try {
    const { title, body, data } = req.body;
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'title and body are required' });
    }

    // Fetch all users that have at least one FCM token
    const users = await User.find({ fcmTokens: { $exists: true, $not: { $size: 0 } } }).select('+fcmTokens');
    const allTokens = users.flatMap((u) => u.fcmTokens);

    if (allTokens.length === 0) {
      return res.status(200).json({ success: true, message: 'No subscribers to notify', data: { successCount: 0 } });
    }

    // FCM sendEachForMulticast supports max 500 tokens per call — batch it
    let totalSuccess = 0;
    let totalFail = 0;
    const allInvalidTokens = [];

    for (let i = 0; i < allTokens.length; i += 500) {
      const batch = allTokens.slice(i, i + 500);
      const result = await sendToMultiple(batch, title, body, data || {});
      totalSuccess += result.successCount;
      totalFail += result.failureCount;
      allInvalidTokens.push(...result.invalidTokens);
    }

    // Remove stale tokens
    if (allInvalidTokens.length > 0) {
      await User.updateMany(
        { fcmTokens: { $in: allInvalidTokens } },
        { $pull: { fcmTokens: { $in: allInvalidTokens } } }
      );
      logger.info(`Removed ${allInvalidTokens.length} stale FCM tokens`);
    }

    logger.info(`Broadcast sent — success: ${totalSuccess}, fail: ${totalFail}`);
    res.status(200).json({
      success: true,
      data: { successCount: totalSuccess, failureCount: totalFail },
    });
  } catch (error) {
    next(error);
  }
};
