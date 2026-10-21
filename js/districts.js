// Районы: к какому микрорайону относится точка и сколько его улиц открыто.
//
// В OSM микрорайоны материковой части Владивостока почти не размечены полигонами,
// поэтому район — это «ближайший центр» (диаграмма Вороного) не дальше MAX_R.
// Прогресс считается не по площади (в неё попадали бы море и сопки), а по «уличным»
// ячейкам тумана: через них проходит пешеходная дорога из OSM. 100 % — ты прошёл все улицы района.

import { distance, cellOf, cellKey } from "./geo.js";
import { load, save } from "./storage.js";

/**
 * Центры микрорайонов. Координаты — по остановкам/станциям из OSM (Nominatim), ±300 м.
 * Остров Русский и Щитовая — по точкам place=suburb из OSM.
 */
export const DISTRICTS = [
  { id: "center",     name: "Центр",               lat: 43.1165, lon: 131.8860 },
  { id: "eagle",      name: "Орлиная сопка",       lat: 43.1225, lon: 131.8950 },
  { id: "egersheld",  name: "Эгершельд",           lat: 43.0952, lon: 131.8647 },
  { id: "churkin",    name: "Чуркин",              lat: 43.0960, lon: 131.9100 },
  { id: "zmeinka",    name: "Змеинка",             lat: 43.0859, lon: 131.8939 },
  { id: "dalzavod",   name: "Дальзавод",           lat: 43.1130, lon: 131.9120 },
  { id: "rechka1",    name: "Первая Речка",        lat: 43.1371, lon: 131.9027 },
  { id: "morgorodok", name: "Моргородок",          lat: 43.1477, lon: 131.9045 },
  { id: "rechka2",    name: "Вторая Речка",        lat: 43.1640, lon: 131.9080 },
  { id: "zarya",      name: "Заря",                lat: 43.1802, lon: 131.9205 },
  { id: "chaika",     name: "Чайка",               lat: 43.1960, lon: 131.9210 },
  { id: "sedanka",    name: "Седанка",             lat: 43.2132, lon: 131.9567 },
  { id: "okeanskaya", name: "Океанская",           lat: 43.2352, lon: 132.0071 },
  { id: "sadgorod",   name: "Садгород",            lat: 43.2627, lon: 132.0407 },
  { id: "snegovaya",  name: "Снеговая Падь",       lat: 43.1633, lon: 131.9569 },
  { id: "balyaeva",   name: "Баляева",             lat: 43.1280, lon: 131.9420 },
  { id: "lugovaya",   name: "Луговая",             lat: 43.1110, lon: 131.9380 },
  { id: "zeleny",     name: "Зелёный Угол",        lat: 43.1190, lon: 131.9650 },
  { id: "neybuta",    name: "Нейбута",             lat: 43.1040, lon: 131.9603 },
  { id: "borisenko",  name: "Борисенко",           lat: 43.0977, lon: 131.9543 },
  { id: "tikhaya",    name: "Тихая",               lat: 43.0930, lon: 131.9700 },
  { id: "patrokl",    name: "Патрокл",             lat: 43.0780, lon: 131.9620 },
  { id: "shitovaya",  name: "Щитовая",             lat: 43.1268, lon: 132.0149 },
  { id: "rybachy",    name: "Рыбачий",             lat: 43.1347, lon: 132.0378 },
  { id: "ajax",       name: "Аякс (ДВФУ)",         lat: 43.0281, lon: 131.8941 },
  { id: "melkovodny", name: "Мелководный",         lat: 43.0170, lon: 131.8877 },
  { id: "paris",      name: "Парис",               lat: 43.0115, lon: 131.8967 },
  { id: "ekipazhny",  name: "Экипажный",           lat: 43.0106, lon: 131.8705 },
  { id: "minka",      name: "Минка",               lat: 43.0300, lon: 131.8734 },
  { id: "shigino",    name: "Шигино",              lat: 43.0351, lon: 131.8531 },
  { id: "ket",        name: "КЭТ",                 lat: 43.0265, lon: 131.8594 },
  { id: "kanal",      name: "Канал",               lat: 43.0576, lon: 131.8501 },
  { id: "pospelovo",  name: "Поспелово",           lat: 43.0581, lon: 131.8835 },
  { id: "podnozhye",  name: "Подножье",            lat: 43.0448, lon: 131.8227 },
  { id: "rynda",      name: "Рында",               lat: 43.0323, lon: 131.8049 },
  { id: "zhitkova",   name: "Житкова",             lat: 43.0232, lon: 131.9283 },
];

const RETRY = 120000; // мс до повторной загрузки улиц после ошибки Overpass
const MAX_R = 1800; // м — дальше любого центра считаем «окраиной» без района
const BY_ID = new Map(DISTRICTS.map((d) => [d.id, d]));

/** Пороги открытия и награды за них. 90 % — «район открыт»: часть улиц всегда за заборами. */
export const MILESTONES = [
  { pct: 25, cash: 200, rep: 0 },
  { pct: 50, cash: 500, rep: 1 },
  { pct: 75, cash: 1000, rep: 1 },
  { pct: 90, cash: 2500, rep: 2 },
];

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
// Пешеходные улицы. Тротуары и переходы дублируют проезжую часть, дворовые проезды к парковкам — мусор.
const HIGHWAYS = "primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|footway|steps|service";

/** Район, к которому относится точка, или null. */
export function districtAt(p) {
  let best = null, bd = MAX_R;
  for (const d of DISTRICTS) {
    const dist = distance(p, d);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

export class DistrictService {
  constructor(fog) {
    this.fog = fog;
    this.streets = new Map();  // id → Set ключей уличных ячеек
    this.explored = new Map(); // id → сколько из них открыто
    this.reached = load("districtMilestones", {}); // id → последний достигнутый порог, %
    this.current = null;
    this.loading = null;
    this.retryAt = new Map(); // id → когда можно снова попробовать загрузить улицы после ошибки
    this.listeners = [];
    fog.onChange((added, keys) => this._onReveal(keys));
  }

  /** События: ("enter", district|null), ("progress", district), ("milestone", district, milestone). */
  on(fn) {
    this.listeners.push(fn);
  }

  /** Вызывать при движении игрока. */
  update(p) {
    const d = districtAt(p);
    if (d?.id !== this.current?.id) {
      this.current = d;
      this._emit("enter", d);
    }
    if (d) this._ensure(d);
  }

  /** Процент открытия района или null, если улицы ещё не загружены. */
  percent(id) {
    const total = this.streets.get(id)?.size;
    if (!total) return null;
    return (100 * this.explored.get(id)) / total;
  }

  /** Идёт ли загрузка улиц района (для HUD: «…» или «—»). */
  isLoading(id) {
    return this.loading?.id === id;
  }

  /** Районы, где игрок уже бывал (улицы в кэше), по убыванию прогресса. */
  summary() {
    for (const d of DISTRICTS) if (!this.streets.has(d.id)) this._fromCache(d);
    return DISTRICTS.filter((d) => this.streets.has(d.id))
      .map((d) => ({ ...d, pct: this.percent(d.id) ?? 0, total: this.streets.get(d.id).size }))
      .sort((a, b) => b.pct - a.pct);
  }

  reset() {
    this.reached = {};
    save("districtMilestones", this.reached);
    for (const id of this.streets.keys()) this._recount(id);
  }

  // ---------- внутреннее ----------

  _emit(...args) {
    this.listeners.forEach((fn) => fn(...args));
  }

  _onReveal(keys) {
    if (!keys.length) {
      // Сброс тумана — пересчитываем всё
      for (const id of this.streets.keys()) this._recount(id);
      return;
    }
    for (const [id, set] of this.streets) {
      let n = 0;
      for (const k of keys) if (set.has(k)) n++;
      if (!n) continue;
      this.explored.set(id, this.explored.get(id) + n);
      this._checkMilestones(BY_ID.get(id));
      this._emit("progress", BY_ID.get(id));
    }
  }

  _recount(id) {
    let n = 0;
    for (const k of this.streets.get(id)) if (this.fog.cells.has(k)) n++;
    this.explored.set(id, n);
  }

  _setStreets(d, set) {
    this.streets.set(d.id, set);
    this._recount(d.id);
    // Уже пройденные пороги не награждаем повторно — только фиксируем
    const pct = this.percent(d.id) ?? 0;
    if (this.reached[d.id] == null) {
      this.reached[d.id] = MILESTONES.filter((m) => pct >= m.pct).at(-1)?.pct || 0;
      save("districtMilestones", this.reached);
    }
    this._emit("progress", d);
  }

  _checkMilestones(d) {
    const pct = this.percent(d.id);
    if (pct == null) return;
    const prev = this.reached[d.id] || 0;
    const crossed = MILESTONES.filter((x) => x.pct > prev && pct >= x.pct);
    if (!crossed.length) return;
    // За один скачок могли перейти несколько порогов — награды суммируем, баннер по старшему
    const m = { pct: crossed.at(-1).pct, cash: 0, rep: 0 };
    for (const x of crossed) { m.cash += x.cash; m.rep += x.rep; }
    this.reached[d.id] = m.pct;
    save("districtMilestones", this.reached);
    this._emit("milestone", d, m);
  }

  _fromCache(d) {
    const cached = load("streets:" + d.id, null);
    if (!cached) return false;
    this._setStreets(d, new Set(decodeKeys(cached)));
    return true;
  }

  async _ensure(d) {
    if (this.streets.has(d.id) || this.loading) return;
    if (this._fromCache(d)) return;
    if (Date.now() < (this.retryAt.get(d.id) || 0)) return;
    const loading = { id: d.id };
    this.loading = loading;
    this._emit("progress", d);
    fetchStreets(d)
      .then((set) => {
        save("streets:" + d.id, encodeKeys(set));
        this.loading = null;
        this._setStreets(d, set);
      })
      .catch((e) => {
        console.warn(`[districts] улицы района «${d.name}» не загрузились, повторю через ${RETRY / 1000} с`, e);
        this.retryAt.set(d.id, Date.now() + RETRY); // Overpass часто перегружен — не долбим его подряд
        this.loading = null;
        this._emit("progress", d);
      });
  }
}

/** Скачать пешеходные улицы района из Overpass и превратить их в ключи ячеек тумана. */
async function fetchStreets(d) {
  const [s, w, n, e] = regionBbox(d);
  const q = `[out:json][timeout:60];
way["highway"~"^(${HIGHWAYS})$"]["access"!~"^(private|no)$"]["foot"!="no"]["footway"!~"^(sidewalk|crossing)$"]["service"!~"^(parking_aisle|driveway|drive-through)$"](${s},${w},${n},${e});
out skel geom qt;`;
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
      return rasterize(json.elements, d);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Ячейки, через которые проходят линии дорог и которые принадлежат району d. */
function rasterize(ways, d) {
  const out = new Set();
  const owner = new Map(); // ключ ячейки → id района (кэш, у соседних точек одна ячейка)
  const STEP = 8; // м — шаг выборки вдоль линии, меньше ячейки
  const add = (p) => {
    const { row, col } = cellOf(p);
    const k = cellKey(row, col);
    let id = owner.get(k);
    if (id === undefined) {
      id = districtAt(p)?.id ?? null;
      owner.set(k, id);
    }
    if (id === d.id) out.add(k);
  };
  for (const w of ways) {
    const g = w.geometry;
    if (!g?.length) continue;
    add(g[0]);
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i];
      const n = Math.ceil(distance(a, b) / STEP);
      for (let j = 1; j <= n; j++) add({ lat: a.lat + ((b.lat - a.lat) * j) / n, lon: a.lon + ((b.lon - a.lon) * j) / n });
    }
  }
  return out;
}

/** Рамка [юг, запад, север, восток] вокруг области района: проверяем сетку 100 м в пределах MAX_R. */
function regionBbox(d) {
  const dLat = MAX_R / 111320;
  const dLon = MAX_R / (111320 * Math.cos((d.lat * Math.PI) / 180));
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  const N = Math.ceil(MAX_R / 100);
  for (let i = -N; i <= N; i++) {
    for (let j = -N; j <= N; j++) {
      const p = { lat: d.lat + (dLat * i) / N, lon: d.lon + (dLon * j) / N };
      if (districtAt(p)?.id !== d.id) continue;
      s = Math.min(s, p.lat); n = Math.max(n, p.lat);
      w = Math.min(w, p.lon); e = Math.max(e, p.lon);
    }
  }
  const padLat = 100 / 111320, padLon = padLat / Math.cos((d.lat * Math.PI) / 180);
  return [s - padLat, w - padLon, n + padLat, e + padLon].map((v) => v.toFixed(5));
}

// Компактное хранение: "row:c0,+d1,+d2;row:…" — столбцы по возрастанию, дальше разности.
function encodeKeys(set) {
  const rows = new Map();
  for (const k of set) {
    const i = k.indexOf(":");
    const r = k.slice(0, i);
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push(+k.slice(i + 1));
  }
  const parts = [];
  for (const [r, cols] of rows) {
    cols.sort((a, b) => a - b);
    parts.push(r + ":" + cols.map((c, i) => (i ? c - cols[i - 1] : c)).join(","));
  }
  return parts.join(";");
}

function decodeKeys(str) {
  const out = [];
  if (!str) return out;
  for (const part of str.split(";")) {
    const i = part.indexOf(":");
    const r = part.slice(0, i);
    let c = 0;
    part.slice(i + 1).split(",").forEach((v, j) => {
      c = j ? c + +v : +v;
      out.push(r + ":" + c);
    });
  }
  return out;
}
