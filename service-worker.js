// ==========================================================================
// Service worker: caches the app shell so the UI loads offline.
// Firestore's own SDK cache (enabled in js/firestore.js) handles data
// offline separately — this only covers the static files.
// ==========================================================================
const CACHE_NAME = "study-mission-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/auth.js",
  "./js/firestore.js",
  "./js/planner.js",
  "./js/charts.js",
  "./js/notifications.js",
  "./js/confetti.js",
  "./js/config.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Never intercept Firebase/Google API calls — let those hit the network
  // (or fail fast so the Firestore SDK's own offline queue takes over).
  if (req.url.includes("googleapis.com") || req.url.includes("firebaseio.com") || req.url.includes("gstatic.com")) {
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
