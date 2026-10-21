const CACHE_NAME = "fuel-shift-shell-v56";
const SHELL = [
  "/admin-login.html",
  "/admin-logistics.html",
  "/admin-logistics-dashboard.html",
  "/admin-logistics-deliveries.html",
  "/admin-logistics-history.html",
  "/attendant-login.html",
  "/manifest.webmanifest",
  "/admin-manifest.webmanifest",
  "/icons/app-icon.svg",
  "/icons/attendant-icon.svg",
  "/icons/admin-icon.svg",
  "/icons/notification-mea.svg"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // A single missing asset must not prevent the whole app from installing.
    await Promise.all(SHELL.map(async path => {
      try {
        const response = await fetch(path, { cache: "reload" });
        if (response.ok) await cache.put(path, response);
      } catch (_) {
        // Keep installing; online navigation will still work.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("fuel-shift-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (_) {
        const path = url.pathname;
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(path)) || (await cache.match("/admin-login.html"));
      }
    })());
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url.pathname);
      const network = fetch(request).then(response => {
        if (response.ok) cache.put(url.pathname, response.clone());
        return response;
      }).catch(() => cached);
      return cached || network;
    })());
  }
});
