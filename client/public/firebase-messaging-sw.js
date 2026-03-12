// firebase-messaging-sw.js
// Background push notification handler for Tasdeeq (Fake News Detector)
//
// IMPORTANT: The config values below must match your Firebase Web App config exactly.
// Copy them from: Firebase Console → Project Settings → General → Your Web App
// ─────────────────────────────────────────────────────────────────────────────
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBv7hzSFaS6XmiqOC-Z--ky8TIfUDJvDRA',
  authDomain: 'tasdeeq-notifications.firebaseapp.com',
  projectId: 'tasdeeq-notifications',
  storageBucket: 'tasdeeq-notifications.firebasestorage.app',
  messagingSenderId: '167144796179',
  appId: '1:167144796179:web:dca3c95184ffc32eb1cfe6',
});

const messaging = firebase.messaging();

// Handle background push messages (app is closed or in background tab)
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Tasdeeq';
  const body  = payload.notification?.body  || '';
  const icon  = payload.notification?.icon  || '/logo192.png';

  self.registration.showNotification(title, {
    body,
    icon,
    badge: '/logo192.png',
    data: payload.data || {},
    // Keep notification visible until the user interacts
    requireInteraction: false,
  });
});

// Open / focus the app when the user taps a notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.link || '/';
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});
