const CACHE_NAME = "fuel-shift-shell-v53";
const SHELL = [
  "/admin-login.html",
  "/admin-logistics.html",
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
    await Promise.all(keys
      .filter(key => key.startsWith("fuel-shift-shell-") && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function fallbackFor(pathname) {
  if (pathname.startsWith("/admin-logistics-")) return "/admin-logistics.html";
  if (pathname.startsWith("/admin-") || pathname === "/setup-admin.html") return "/admin-login.html";
  if (pathname.startsWith("/attendant-") || pathname === "/shift.html" || pathname === "/pending-handovers.html") return "/attendant-login.html";
  return null;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (_) {
        const cachedPage = await caches.match(request, { ignoreSearch: true });
        if (cachedPage) return cachedPage;
        const fallback = fallbackFor(url.pathname);
        if (fallback) {
          const cachedFallback = await caches.match(fallback);
          if (cachedFallback) return cachedFallback;
        }
        return new Response(
          "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Connection required</title><body style=\"font:16px system-ui;padding:24px;line-height:1.5\"><h2>Connection required</h2><p>This page could not be loaded. Check your internet connection and try again.</p><button onclick=\"location.reload()\">Retry</button></body></html>",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
        );
      }
    })());
    return;
  }

  // Cache static assets at runtime so repeat page loads are fast and
  // an intermittent connection does not leave pages without their scripts.
  // API responses are deliberately excluded above.
  if (url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname.endsWith(".webmanifest")) {
    const cachePromise = caches.open(CACHE_NAME);
    const refreshPromise = cachePromise.then(cache =>
      fetch(request).then(async response => {
        if (response.ok && response.type !== "opaque") {
          await cache.put(request, response.clone());
        }
        return response;
      })
    );

    // Register the refresh while the fetch event is still being handled.
    event.waitUntil(refreshPromise.then(() => undefined).catch(() => undefined));
    event.respondWith((async () => {
      const cache = await cachePromise;
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        return await refreshPromise;
      } catch (_) {
        return new Response("Static asset unavailable. Check your connection and retry.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
        });
      }
    })());
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (_) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response("", { status: 504, statusText: "Gateway Timeout" });
      }
    })());
  }
});


self.addEventListener("push", event => {
  let data = { title: "Fuel Shift System", body: "A shift handover is waiting for your confirmation.", url: "/attendant-dashboard.html" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (_) {}
  const isAdmin = String(data.notification_type || "").startsWith("admin_") || String(data.app_role || "").toLowerCase() === "admin";
  const stockLines = Array.isArray(data.stock_lines) ? data.stock_lines.map(line => String(line)) : [];
  const options = {
    body: String(data.body || "A shift handover is waiting for your confirmation."),
    icon: isAdmin ? "/icons/admin-icon.svg" : "/icons/attendant-icon.svg",
    // Keep the compact monochrome badge suitable for Android notification trays.
    badge: "/icons/notification-mea.svg",
    tag: String(data.tag || ("fuel-handover-" + (data.handover_id || "pending"))),
    // Stable tags replace the existing alert without buzzing again when an event is reprocessed.
    renotify: false,
    requireInteraction: true,
    silent: false,
    vibrate: [180, 80, 180],
    timestamp: Date.now(),
    lang: "en",
    dir: "auto",
    data: { url: String(data.url || "/attendant-dashboard.html"), handover_id: data.handover_id || null, notification_type: data.notification_type || "incoming", stock_lines: stockLines }
  };
  // Keep admin and attendant phone notifications consistent, with a role-specific
  // icon/badge and a clear next action for each notification type.
  if (data.notification_type === "admin_dsr_confirmed_stock" && stockLines.length) {
    // Keep every tank on one expandable phone notification, with product-colour
    // markers supplied from the database. Repeated delivery for the same DSR
    // replaces the existing card without buzzing the administrator twice.
    options.body = stockLines.join("\n");
    options.renotify = false;
    options.actions = [{ action: "view", title: "View tank stocks" }];
  } else if (data.notification_type === "admin_low_stock") {
    options.renotify = false;
    options.actions = [{ action: "view", title: "View inventory" }];
  } else if (data.notification_type === "admin_purchase_pending") {
    options.renotify = false;
    options.actions = [{ action: "view", title: "View purchase" }];
  } else if (data.notification_type === "admin_pending_sales") {
    options.actions = [{ action: "review", title: "Review sales" }];
  } else if (data.notification_type === "admin_dsr_ready") {
    options.actions = [{ action: "review", title: "Review DSR" }];
  } else if (data.notification_type === "record_sale_ready") {
    options.actions = [{ action: "record", title: "Record sale" }];
  } else {
    options.actions = [{ action: "handover", title: "Open handover" }];
  }
  event.waitUntil(self.registration.showNotification(String(data.title || "Fuel Shift System"), options));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const fallbackTarget = new URL("/attendant-dashboard.html", self.location.origin);
  let target = fallbackTarget.href;
  try {
    const requestedTarget = new URL(String(event.notification.data?.url || fallbackTarget.pathname), self.location.origin);
    // Push payloads should only navigate inside this app, even if malformed or
    // unexpected data reaches the service worker.
    if (requestedTarget.origin === self.location.origin) target = requestedTarget.href;
  } catch (_) {
    target = fallbackTarget.href;
  }
  event.waitUntil((async () => {
    const openClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of openClients) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
