// Точки интереса: реальные места из OpenStreetMap (Overpass API) + встроенные достопримечательности Владивостока.

import { distance } from "./geo.js";
import { load, save } from "./storage.js";

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const RADIUS = 1500;           // м вокруг игрока
const CACHE_TTL = 7 * 864e5;   // неделя
const TILE_DEG = 0.02;         // кэшируем кусками ~2×1.6 км

/**
 * Встроенные достопримечательности. Координаты приблизительные (±50–100 м) —
 * уточни их по карте, если точка встаёт не туда.
 * Эти id используются сюжетными арками в quests/story-vladivostok.js.
 */
export const LANDMARKS = [
  { id: "lm:square",      name: "Центральная площадь",            lat: 43.1155, lon: 131.8855, kind: "landmark" },
  { id: "lm:arbat",       name: "Арбат (ул. Адмирала Фокина)",     lat: 43.1170, lon: 131.8818, kind: "landmark" },
  { id: "lm:sport",       name: "Спортивная гавань",              lat: 43.1178, lon: 131.8775, kind: "water" },
  { id: "lm:station",     name: "Ж/д вокзал",                     lat: 43.1112, lon: 131.8818, kind: "landmark" },
  { id: "lm:s56",         name: "Подлодка С-56",                  lat: 43.1142, lon: 131.8937, kind: "culture" },
  { id: "lm:korabelnaya", name: "Корабельная набережная",         lat: 43.1133, lon: 131.8900, kind: "water" },
  { id: "lm:funicular",   name: "Фуникулёр (нижняя станция)",     lat: 43.1178, lon: 131.8950, kind: "landmark" },
  { id: "lm:eagle",       name: "Смотровая «Орлиное гнездо»",     lat: 43.1210, lon: 131.8925, kind: "view" },
  { id: "lm:goldbridge",  name: "Золотой мост",                   lat: 43.1105, lon: 131.8905, kind: "landmark" },
  { id: "lm:millionka",   name: "Миллионка",                      lat: 43.1178, lon: 131.8868, kind: "landmark" },
  { id: "lm:dinamo",      name: "Стадион «Динамо»",               lat: 43.1195, lon: 131.8795, kind: "landmark" },
  { id: "lm:pokrovsky",   name: "Покровский парк",                lat: 43.1272, lon: 131.8960, kind: "park" },
  { id: "lm:tokarevsky",  name: "Токаревский маяк",               lat: 43.0737, lon: 131.8425, kind: "view" },
  { id: "lm:russkybridge",name: "Русский мост (смотровая)",        lat: 43.0620, lon: 131.9050, kind: "view" },
];

export class PoiService {
  constructor() {
    this.pois = new Map(LANDMARKS.map((p) => [p.id, p]));
    this.loadedTiles = new Set();
    this.loading = null;
    this.status = "landmarks"; // 'landmarks' | 'osm' | 'offline'
  }

  get(id) {
    return this.pois.get(id);
  }

  /** Точки в радиусе от игрока, отсортированные по расстоянию. */
  near(p, maxDist = RADIUS, filter = () => true) {
    const out = [];
    for (const poi of this.pois.values()) {
      if (!filter(poi)) continue;
      const d = distance(p, poi);
      if (d <= maxDist) out.push({ ...poi, dist: d });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  /** Подгрузить места из OSM вокруг игрока (с кэшем). Безопасно вызывать часто. */
  async ensureAround(p) {
    const key = `${Math.floor(p.lat / TILE_DEG)}_${Math.floor(p.lon / TILE_DEG)}`;
    if (this.loadedTiles.has(key) || this.loading) return;

    const cached = load("poi:" + key, null);
    if (cached && Date.now() - cached.t < CACHE_TTL) {
      this._add(cached.items);
      this.loadedTiles.add(key);
      this.status = "osm";
      return;
    }

    this.loading = this._fetch(p)
      .then((items) => {
        this._add(items);
        save("poi:" + key, { t: Date.now(), items });
        this.loadedTiles.add(key);
        this.status = "osm";
      })
      .catch((e) => {
        console.warn("[poi] Overpass недоступен, работаем на встроенных точках", e);
        this.status = "offline";
        this.loadedTiles.add(key); // не долбим сервер повторно в эту сессию
      })
      .finally(() => (this.loading = null));
    return this.loading;
  }

  _add(items) {
    for (const it of items) this.pois.set(it.id, it);
  }

  async _fetch(p) {
    const a = `around:${RADIUS},${p.lat},${p.lon}`;
    const q = `[out:json][timeout:25];
(
  nwr(${a})["amenity"~"^(cafe|restaurant|bar|pub|fast_food|pharmacy|theatre|cinema|marketplace|ferry_terminal|fuel|library|university)$"]["name"];
  nwr(${a})["tourism"~"^(attraction|viewpoint|museum|artwork|gallery)$"];
  nwr(${a})["historic"~"^(memorial|monument|ship|fort|building)$"]["name"];
  nwr(${a})["man_made"~"^(lighthouse|pier)$"];
  nwr(${a})["leisure"~"^(park|garden|stadium|playground)$"]["name"];
  nwr(${a})["shop"~"^(convenience|supermarket|mall|seafood|car_parts|car)$"]["name"];
);
out center 500;`;

    let lastErr;
    for (const url of OVERPASS) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 30000);
        const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), signal: ctrl.signal,
          headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        clearTimeout(t);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        return json.elements.map(toPoi).filter(Boolean);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }
}

function toPoi(el) {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null) return null;
  const t = el.tags || {};
  const kind = classify(t);
  const name = t.name || t["name:ru"] || defaultName(t, kind);
  if (!name) return null;
  return { id: `${el.type[0]}${el.id}`, name, lat, lon, kind };
}

/** Сводим теги OSM к игровым категориям. */
function classify(t) {
  if (/^(cafe|restaurant|fast_food)$/.test(t.amenity)) return "food";
  if (/^(bar|pub)$/.test(t.amenity)) return "bar";
  if (t.leisure) return t.leisure === "stadium" ? "landmark" : "park";
  if (t.tourism === "viewpoint" || t.man_made === "lighthouse") return "view";
  if (t.man_made === "pier" || t.amenity === "ferry_terminal") return "water";
  if (/^(museum|gallery|artwork)$/.test(t.tourism) || /^(theatre|cinema|library)$/.test(t.amenity)) return "culture";
  if (t.historic || t.tourism === "attraction") return "landmark";
  if (t.amenity === "fuel" || t.shop === "car" || t.shop === "car_parts") return "auto";
  if (t.shop || t.amenity === "marketplace") return "shop";
  return "misc";
}

function defaultName(t, kind) {
  if (t.man_made === "pier") return "Причал";
  if (t.man_made === "lighthouse") return "Маяк";
  if (t.tourism === "viewpoint") return "Смотровая площадка";
  if (t.tourism === "artwork") return "Арт-объект";
  return null;
}

export const KIND_LABEL = {
  food: "еда", bar: "бар", park: "парк", view: "вид", water: "у воды",
  culture: "культура", landmark: "место", shop: "магазин", auto: "авто", misc: "место",
};
