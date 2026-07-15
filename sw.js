const ASSET_VERSION = "v20260715-02";
const CACHE_NAME = `paruru-mini-${ASSET_VERSION}`;
const versioned = (path) => `${path}?v=${ASSET_VERSION}`;
const DEBUG = false;

const APP_SHELL_RUNTIME_ASSETS = [
  "./",
  "index.html",
  versioned("style.css"),
  versioned("app.js"),
  "manifest.json",
];

const STATIC_IMAGE_ASSETS = [
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
  debugLog("[Paruru SW] install", ASSET_VERSION);
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_IMAGE_ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  debugLog("[Paruru SW] activate", ASSET_VERSION);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
        return Promise.resolve(false);
      }))
    )
      .then(() => warmAppShellCache())
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    debugLog("[Paruru SW] SKIP_WAITING message");
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, getAppShellFallbackUrl()));
    return;
  }

  if (isAppShellRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isImageRequest(request)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok && isCacheableSameOrigin(request)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: shouldIgnoreSearch(request) });
    if (cached) {
      return cached;
    }

    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl, { ignoreSearch: true });
      if (fallback) {
        return fallback;
      }
    }

    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok && isCacheableSameOrigin(request)) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function warmAppShellCache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(APP_SHELL_RUNTIME_ASSETS.map(async (path) => {
    const request = new Request(new URL(path, self.registration.scope).toString(), {
      cache: "no-store",
    });
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
  }));
}

function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

function getAppShellFallbackUrl() {
  return new URL("./", self.registration.scope).toString();
}

function isAppShellRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  return (
    pathname.endsWith("/") ||
    pathname.endsWith(".html") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".json") ||
    pathname.endsWith("/manifest.webmanifest")
  );
}

function isImageRequest(request) {
  if (request.destination === "image") {
    return true;
  }

  const pathname = new URL(request.url).pathname.toLowerCase();
  return /\.(png|jpg|jpeg|webp|gif|svg|ico)$/.test(pathname);
}

function isCacheableSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

function shouldIgnoreSearch(request) {
  const url = new URL(request.url);
  return isAppShellRequest(request) && url.origin === self.location.origin;
}




