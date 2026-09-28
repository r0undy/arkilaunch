// Web Push service worker (docs/cr-arkilaunch-weather-monitoring.md).
// W3C Push API only: the server signs with its own VAPID keys; no
// Firebase or other third-party SDK. It shows the weather notice and opens
// its page when tapped.
/* global self, URL */
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Weather alert', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Weather alert', {
      body: data.body || '',
      data: { url: data.url || '/' },
      tag: data.url || 'weather',
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
