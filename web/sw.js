/* Rivera Quote Studio — offline cache */
const VERSION = "rqs-202611140855";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png"];
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|tessdata\.projectnaptha\.com)\//;
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.includes("/webapi/")) return;
  if (req.mode === "navigate") {
    /* fresh page when the network answers within 2.5 s, otherwise open the saved copy at once (slow mobile data) and refresh it in the background */
    const key = /admin\.html$/.test(url.pathname) ? "./admin.html" : "./index.html";
    const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(key, c)); } return r; });
    e.respondWith(new Promise(res => {
      let done = false; const fin = r => { if (!done && r) { done = true; res(r); } };
      const t = setTimeout(() => caches.match(key).then(fin), 2500);
      net.then(r => { clearTimeout(t); fin(r); }).catch(() => caches.match(key).then(h => { fin(h || Response.error()); }));
    }));
    return;
  }
  if (CDN.test(req.url)) { e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return r; }))); return; }
  if (url.origin === location.origin) { e.respondWith(caches.match(req).then(hit => { const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return r; }).catch(() => hit); return hit || net; })); }
});
