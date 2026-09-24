/* JobOS service worker: gjør kontor-appen installerbar og gir et offline-skall.
   Sider og filer hentes fra nett først; ved manglende nett brukes sist lagrede kopi.
   Firebase-kall (googleapis.com) går alltid direkte til nett og lagres aldri. */
const CACHE = "jobos-v1";
const SHELL = [
  "app.html", "logg-inn.html", "index.html", "manifest.webmanifest", "favicon.svg",
  "assets/style.css", "assets/office.css", "assets/office.js", "assets/firestore.js",
  "assets/auth.js", "assets/firebase-config.js", "assets/logo.svg", "assets/icons/icon-192.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match("app.html")))
  );
});
