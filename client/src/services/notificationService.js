import { getToken, onMessage } from 'firebase/messaging';
import { getMessagingInstance } from '../firebase';
import api from './api';

const VAPID_KEY = process.env.REACT_APP_FIREBASE_VAPID_KEY;

/**
 * Request notification permission, obtain the FCM token, and register it
 * with the backend.  Safe to call multiple times — no-ops if already done.
 *
 * @returns {Promise<string|null>} The FCM token, or null if unavailable.
 */
export const initNotifications = async () => {
  try {
    // 1. Check browser support
    if (!('Notification' in window)) return null;
    if (!('serviceWorker' in navigator)) return null;

    // 2. Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    // 3. Get the Firebase messaging instance
    const messaging = await getMessagingInstance();
    if (!messaging) return null;

    // 4. Register the service worker (must be served from public/)
    const registration = await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js'
    );

    // 5. Get the FCM token
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) return null;

    // Persist token for logout cleanup
    localStorage.setItem('fn_fcm_token', token);

    // 6. Save the token to the backend (fire-and-forget; auth header is set by api interceptor)
    await api.post('/notifications/token', { token }).catch(() => {
      // Non-fatal — token will be re-registered on next login
    });

    return token;
  } catch (err) {
    // Silently swallow: unsupported browser, user blocked permission, etc.
    console.warn('FCM init failed:', err.message);
    return null;
  }
};

/**
 * Remove the FCM token from the backend (call on logout).
 * @param {string} token
 */
export const removeNotificationToken = async (token) => {
  if (!token) return;
  try {
    await api.delete('/notifications/token', { data: { token } });
  } catch {
    // Non-fatal
  }
};

/**
 * Listen for foreground push messages and call the provided callback.
 * Returns an unsubscribe function.
 * @param {function} callback  - receives the FCM MessagePayload
 */
export const onForegroundMessage = async (callback) => {
  const messaging = await getMessagingInstance();
  if (!messaging) return () => {};
  return onMessage(messaging, callback);
};
