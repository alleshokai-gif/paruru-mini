const ASSET_VERSION = "v20260710-01";
const CACHE_NAME = `paruru-mini-${ASSET_VERSION}`;
const versioned = (path) => `${path}?v=${ASSET_VERSION}`;
const ASSETS = [
  "./",
  "index.html",
  versioned("style.css"),
  versioned("app.js"),
  "manifest.json",
  versioned("assets/icons/favicon.png"),
  versioned("assets/icons/icon-192.png"),
  versioned("assets/icons/icon-512.png"),
  versioned("assets/character/official/paruru_face.png"),
  versioned("assets/character/official/paruru_bust.png"),
  versioned("assets/character/expressions/paruru_bust_normal.png"),
  versioned("assets/character/expressions/paruru_bust_smile.png"),
  versioned("assets/character/expressions/paruru_bust_angry.png"),
  versioned("assets/character/expressions/paruru_bust_sleepy.png"),
  versioned("assets/character/expressions/paruru_bust_happy.png"),
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
        return Promise.resolve(false);
      }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}



