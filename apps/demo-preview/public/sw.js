/* Public offline page only. Never store API responses, authenticated HTML,
 * photos, payroll, documents, or mutation requests in Cache Storage. */
const CACHE_PREFIX = "roadops-public-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_URL = "/mobile/offline.html";
const PUBLIC_ASSETS = [OFFLINE_URL, "/mobile/icon-192.png", "/mobile/icon-512.png", "/mobile/maskable-512.png", "/mobile/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // A failed download/API request must not receive HTML with an apparent success.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (
      await caches.match(OFFLINE_URL)
      ?? new Response("Internet uzildi. Ulanishni tiklab, sahifani qayta oching.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    )));
  } else if (!url.search && PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((response) => response ?? fetch(request)));
  }
});
