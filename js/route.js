// Пешеходные маршруты: OSRM с профилем foot на сервере FOSSGIS (routing.openstreetmap.de, CORS открыт).
// Если сервер недоступен, маршрут — прямая, игра продолжает работать.

import { distance, bearing, lerp } from "./geo.js";

const OSRM = "https://routing.openstreetmap.de/routed-foot/route/v1/driving/";
const TIMEOUT = 8000;
const cache = new Map();

/** Маршрут пешком a → b. Всегда резолвится: при ошибке вернёт прямую с флагом fallback. */
export async function walkRoute(a, b) {
  const key = [a.lat, a.lon, b.lat, b.lon].map((v) => v.toFixed(5)).join(",");
  if (cache.has(key)) return cache.get(key);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    const res = await fetch(`${OSRM}${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    const coords = json.routes?.[0]?.geometry?.coordinates;
    if (!coords?.length) throw new Error(json.code || "нет маршрута");
    // OSRM привязывает концы к ближайшей дороге — добавляем исходные точки, чтобы NPC начинал и заканчивал у места
    const path = new Path([a, ...coords.map(([lon, lat]) => ({ lat, lon })), b]);
    cache.set(key, path);
    return path;
  } catch (e) {
    console.warn("[route] маршрут не построен, иду по прямой", e);
    const path = new Path([a, b]);
    path.fallback = true; // не кэшируем: в следующий раз попробуем снова
    return path;
  }
}

/** Полилиния с накопленной длиной: позиция по пройденному расстоянию. */
export class Path {
  constructor(pts) {
    this.pts = pts.filter((p, i) => i === 0 || distance(pts[i - 1], p) > 0.01);
    if (this.pts.length < 2) this.pts.push(this.pts[0]);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + distance(this.pts[i - 1], this.pts[i]));
    this.length = this.cum[this.cum.length - 1];
    this.fallback = false;
  }

  /** Точка и направление на расстоянии d от начала. */
  at(d) {
    const { pts, cum } = this;
    if (d <= 0) return { ...pts[0], heading: bearing(pts[0], pts[1]) };
    if (d >= this.length) {
      const n = pts.length;
      return { ...pts[n - 1], heading: bearing(pts[n - 2], pts[n - 1]) };
    }
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo];
    const p = lerp(pts[lo], pts[hi], seg ? (d - cum[lo]) / seg : 0);
    return { ...p, heading: bearing(pts[lo], pts[hi]) };
  }
}
