// Service worker: игра ставится на телефон и работает при плохой связи.
// - Файлы игры: сначала сеть (чтобы обновления приходили сразу), без сети — из кэша.
// - Карту OpenFreeMap кэширует сама страница (js/basemap.js): тайлы MapLibre качает из воркера,
//   а такие запросы до service worker не доходят. Здесь только чистим кэш карты при обновлении.
// - Шрифты: из кэша с фоновым обновлением.
// - Overpass, маршруты, Ollama — не трогаем, они сами переживают отсутствие сети.

const VERSION = "v3";
const SHELL = "vlfog-shell-" + VERSION;
const TILES = "vlfog-tiles"; // кэш карты, см. MAP_CACHE в js/offline.js
const FONTS = "vlfog-fonts";

const SHELL_FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "vendor/leaflet/leaflet.css",
  "vendor/leaflet/leaflet.js",
  "vendor/maplibre/maplibre-gl.css",
  "vendor/maplibre/maplibre-gl.js",
  "vendor/maplibre/leaflet-maplibre-gl.js",
  "map/style.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "js/main.js",
  "js/geo.js",
  "js/fog.js",
  "js/player.js",
  "js/poi.js",
  "js/storage.js",
  "js/ui.js",
  "js/route.js",
  "js/radar.js",
  "js/districts.js",
  "js/offline.js",
  "js/basemap.js",
  "js/quests/engine.js",
  "js/quests/schema.js",
  "js/quests/templates.js",
  "js/quests/story-vladivostok.js",
  "js/quests/ollama.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("vlfog-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(dropOldBasemap)
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) return e.respondWith(networkFirst(req));
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return e.respondWith(staleWhileRevalidate(req, FONTS));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") return (await cache.match("index.html")) || Response.error();
    throw err;
  }
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || net;
}

/** До v2 подложкой были растровые тайлы CARTO — после перехода на OpenFreeMap они только занимают место. */
async function dropOldBasemap() {
  const cache = await caches.open(TILES);
  for (const req of await cache.keys()) if (req.url.includes("cartocdn.com")) await cache.delete(req);
}
