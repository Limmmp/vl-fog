// Геометрия: расстояния, сетка тумана, перемещение по азимуту.

export const EARTH_R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Расстояние между двумя точками в метрах (haversine). */
export function distance(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

/** Азимут a→b в градусах (0 = север, по часовой). */
export function bearing(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Сместить точку на meters по азимуту deg. Для коротких дистанций достаточно плоского приближения. */
export function move(p, deg, meters) {
  const dNorth = Math.cos(toRad(deg)) * meters;
  const dEast = Math.sin(toRad(deg)) * meters;
  return {
    lat: p.lat + toDeg(dNorth / EARTH_R),
    lon: p.lon + toDeg(dEast / (EARTH_R * Math.cos(toRad(p.lat)))),
  };
}

/** Смещение b относительно a в метрах: x — на восток, y — на север. Плоское приближение для коротких дистанций. */
export function offsetMeters(a, b) {
  return {
    x: toRad(b.lon - a.lon) * EARTH_R * Math.cos(toRad(a.lat)),
    y: toRad(b.lat - a.lat) * EARTH_R,
  };
}

/** Линейная интерполяция между точками. */
export function lerp(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

// ---------- Сетка тумана ----------
// Мир делится на ячейки ~CELL метров. Строка зависит только от широты,
// столбец — от долготы с учётом широты центра строки, так что ячейки
// примерно квадратные и ключи стабильны.
export const CELL = 20; // метров
const M_PER_DEG_LAT = 111320;

export function cellRowHeightDeg() {
  return CELL / M_PER_DEG_LAT;
}
export function cellColWidthDeg(row) {
  const lat = (row + 0.5) * cellRowHeightDeg();
  return CELL / (M_PER_DEG_LAT * Math.cos(toRad(lat)));
}
export function cellOf(p) {
  const row = Math.floor(p.lat / cellRowHeightDeg());
  const col = Math.floor(p.lon / cellColWidthDeg(row));
  return { row, col };
}
export function cellKey(row, col) {
  return row + ":" + col;
}
export function cellCenter(row, col) {
  const h = cellRowHeightDeg();
  const w = cellColWidthDeg(row);
  return { lat: (row + 0.5) * h, lon: (col + 0.5) * w };
}

/** Все ключи ячеек в радиусе radius метров от точки. */
export function cellsInRadius(p, radius) {
  const out = [];
  const h = cellRowHeightDeg();
  const rows = Math.ceil(radius / CELL) + 1;
  const { row: r0 } = cellOf(p);
  for (let r = r0 - rows; r <= r0 + rows; r++) {
    const w = cellColWidthDeg(r);
    const c0 = Math.floor(p.lon / w);
    for (let c = c0 - rows; c <= c0 + rows; c++) {
      const cc = { lat: (r + 0.5) * h, lon: (c + 0.5) * w };
      if (distance(p, cc) <= radius) out.push(cellKey(r, c));
    }
  }
  return out;
}

export function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(1)} км`;
}
