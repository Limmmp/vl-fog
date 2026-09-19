// Подложка карты: векторные тайлы OpenFreeMap (без ключа), рисует MapLibre GL внутри Leaflet
// через плагин maplibre-gl-leaflet. Стиль — map/style.json (собирается tools/build-map-style.py).
//
// Офлайн: тайлы MapLibre качает из своего воркера, и эти запросы не проходят через service worker.
// Поэтому все адреса OpenFreeMap переписаны на протокол ofm://, а его обработчик (он работает
// в главном потоке) сам берёт данные из кэша карты или из сети и кладёт их в кэш.

import { MAP_CACHE } from "./offline.js";

const PROTO = "ofm";
const HOST = "https://tiles.openfreemap.org";
const CACHE_LIMIT = 4000; // записей в кэше карты, старые вытесняются
const STYLE_URL = new URL("../map/style.json", import.meta.url).href;
const TILEJSON = "https://tiles.openfreemap.org/planet";
const MAX_TILE_ZOOM = 14; // глубже тайлы не нарезаны, MapLibre сам дорисовывает крупные масштабы
// Диапазоны глифов для офлайна: латиница и цифры, кириллица, типографские знаки (— « » …)
const GLYPH_RANGES = ["0-255", "1024-1279", "8192-8447"];

export function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const toProto = (u) => (u.startsWith(HOST) ? PROTO + "://" + u.slice("https://".length) : u);

/** Слой-подложка для Leaflet. */
export async function createBasemap() {
  maplibregl.addProtocol(PROTO, handleRequest);
  const style = await fetch(STYLE_URL).then((r) => r.json());
  style.sprite = toProto(style.sprite);
  style.glyphs = toProto(style.glyphs);
  for (const src of Object.values(style.sources)) {
    if (src.url) src.url = toProto(src.url);
    if (src.tiles) src.tiles = src.tiles.map(toProto);
  }
  return L.maplibreGL({ style, pane: "tilePane" });
}

async function handleRequest(params, abort) {
  const url = "https://" + params.url.slice(PROTO.length + 3);
  const isTileJSON = new URL(url).pathname === "/planet";
  const res = await cachedFetch(url, abort.signal, isTileJSON);
  if (params.type === "json") {
    const json = await res.json();
    if (isTileJSON && json.tiles) json.tiles = json.tiles.map(toProto);
    return { data: json };
  }
  if (params.type === "string") return { data: await res.text() };
  return { data: await res.arrayBuffer() };
}

let putsSinceTrim = 0;
/**
 * Тайлы, спрайты и шрифты — сначала кэш: адреса тайлов версионированы, содержимое не меняется.
 * TileJSON — сначала сеть: в нём ссылка на свежую версию тайлов; без сети — из кэша.
 */
async function cachedFetch(url, signal, networkFirst) {
  const cache = "caches" in window ? await caches.open(MAP_CACHE) : null;
  if (cache && !networkFirst) {
    const hit = await cache.match(url);
    if (hit) return hit;
  }
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    if (cache) {
      await cache.put(url, res.clone());
      if (++putsSinceTrim >= 100) {
        putsSinceTrim = 0;
        trimCache(cache);
      }
    }
    return res;
  } catch (err) {
    const hit = networkFirst && cache ? await cache.match(url) : null;
    if (hit) return hit;
    throw err;
  }
}

async function trimCache(cache) {
  const keys = await cache.keys();
  // keys() возвращает записи в порядке добавления — удаляем самые старые
  for (let i = 0; i < keys.length - CACHE_LIMIT; i++) await cache.delete(keys[i]);
}

/**
 * Всё, что нужно MapLibre, чтобы показать карту вокруг точки без сети:
 * TileJSON, тайлы z10–14, спрайты и глифы шрифтов из стиля.
 */
export async function offlineUrls(center, radiusM) {
  const [style, tj] = await Promise.all([
    fetch(STYLE_URL).then((r) => r.json()),
    fetch(TILEJSON).then((r) => r.json()),
  ]);
  const urls = [TILEJSON];

  const tpl = tj.tiles[0];
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  for (let z = 10; z <= Math.min(MAX_TILE_ZOOM, tj.maxzoom ?? MAX_TILE_ZOOM); z++) {
    const a = tileXY(center.lat + dLat, center.lon - dLon, z);
    const b = tileXY(center.lat - dLat, center.lon + dLon, z);
    for (let x = a.x; x <= b.x; x++) {
      for (let y = a.y; y <= b.y; y++) urls.push(tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y));
    }
  }

  if (typeof style.sprite === "string") {
    for (const suffix of ["", "@2x"]) urls.push(`${style.sprite}${suffix}.json`, `${style.sprite}${suffix}.png`);
  }

  const fonts = new Set();
  for (const l of style.layers) {
    const f = l.layout?.["text-font"];
    if (Array.isArray(f) && f.every((x) => typeof x === "string")) fonts.add(f.join(","));
  }
  for (const stack of fonts) {
    for (const range of GLYPH_RANGES) {
      urls.push(style.glyphs.replace("{fontstack}", encodeURIComponent(stack)).replace("{range}", range));
    }
  }
  return urls;
}

function tileXY(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}
