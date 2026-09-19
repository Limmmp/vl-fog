// Туман войны: набор открытых ячеек + canvas-слой Leaflet поверх тайлов.

import { CELL, cellsInRadius, cellCenter, cellRowHeightDeg, cellColWidthDeg, distance, lerp } from "./geo.js";
import { load, save, debounced } from "./storage.js";

export const REVEAL_RADIUS = 45; // метров вокруг игрока
const PAD = 0.4; // запас холста за пределами экрана, доля от размера

export class FogOfWar {
  constructor() {
    this.cells = new Set(load("fog", []));
    this.listeners = [];
    this._persist = debounced(() => save("fog", [...this.cells]), 2000);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  isRevealed(key) {
    return this.cells.has(key);
  }

  /** Открыть круг вокруг точки. Возвращает число новых ячеек. Слушатели получают (число, ключи новых ячеек). */
  reveal(p, radius = REVEAL_RADIUS) {
    const fresh = [];
    for (const k of cellsInRadius(p, radius)) {
      if (!this.cells.has(k)) {
        this.cells.add(k);
        fresh.push(k);
      }
    }
    if (fresh.length) {
      this._persist();
      this.listeners.forEach((fn) => fn(fresh.length, fresh));
    }
    return fresh.length;
  }

  /** Открыть «коридор» между двумя точками — чтобы между редкими GPS-фиксами не оставалось дыр. */
  revealPath(a, b, radius = REVEAL_RADIUS) {
    const d = distance(a, b);
    if (d > 2000) return this.reveal(b, radius); // телепорт/скачок GPS — не рисуем полосу через весь город
    const steps = Math.max(1, Math.ceil(d / (radius * 0.6)));
    let added = 0;
    for (let i = 1; i <= steps; i++) added += this.reveal(lerp(a, b, i / steps), radius);
    return added;
  }

  /** Площадь открытой территории, км². */
  areaKm2() {
    return (this.cells.size * CELL * CELL) / 1e6;
  }

  reset() {
    this.cells.clear();
    save("fog", []);
    this.listeners.forEach((fn) => fn(0, []));
  }
}

/** Leaflet-слой, рисующий туман. */
export function createFogLayer(fog) {
  const FogLayer = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create("canvas", "fog-canvas leaflet-zoom-animated");
      this._mask = document.createElement("canvas");
      this._pattern = makeFogPattern();
      map.getPane(this.options.pane || "fogPane").appendChild(this._canvas);
      map.on("moveend zoomend viewreset resize", this._redraw, this);
      map.on("zoomanim", this._animateZoom, this);
      fog.onChange(() => this._scheduleRedraw());
      this._redraw();
    },
    onRemove(map) {
      L.DomUtil.remove(this._canvas);
      map.off("moveend zoomend viewreset resize", this._redraw, this);
      map.off("zoomanim", this._animateZoom, this);
    },
    _scheduleRedraw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this._redraw();
      });
    },
    _animateZoom(e) {
      if (!this._bounds) return;
      const map = this._map;
      const scale = map.getZoomScale(e.zoom);
      const offset = map._latLngBoundsToNewLayerBounds(this._bounds, e.zoom, e.center).min;
      L.DomUtil.setTransform(this._canvas, offset, scale);
    },
    _redraw() {
      const map = this._map;
      if (!map) return;
      const size = map.getSize();
      const padX = Math.round(size.x * PAD);
      const padY = Math.round(size.y * PAD);
      const w = size.x + padX * 2;
      const h = size.y + padY * 2;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const topLeftC = L.point(-padX, -padY);
      const topLeftL = map.containerPointToLayerPoint(topLeftC);
      this._bounds = L.latLngBounds(
        map.containerPointToLatLng(topLeftC),
        map.containerPointToLatLng(L.point(size.x + padX, size.y + padY))
      );

      const cv = this._canvas;
      cv.width = w * dpr;
      cv.height = h * dpr;
      cv.style.width = w + "px";
      cv.style.height = h + "px";
      L.DomUtil.setPosition(cv, topLeftL);

      // --- маска открытых ячеек ---
      const mask = this._mask;
      mask.width = cv.width;
      mask.height = cv.height;
      const m = mask.getContext("2d");
      m.setTransform(dpr, 0, 0, dpr, 0, 0);
      m.fillStyle = "#000";

      const zoom = map.getZoom();
      const center = map.getCenter();
      const mPerPx = (40075016.686 * Math.cos((center.lat * Math.PI) / 180)) / Math.pow(2, zoom + 8);
      const r = Math.max(1.2, (CELL * 0.95) / mPerPx);

      const sw = this._bounds.getSouthWest();
      const ne = this._bounds.getNorthEast();
      const rh = cellRowHeightDeg();
      const rowMin = Math.floor(sw.lat / rh) - 1;
      const rowMax = Math.floor(ne.lat / rh) + 1;

      const drawCell = (row, col) => {
        const c = cellCenter(row, col);
        const pt = map.latLngToLayerPoint([c.lat, c.lon]).subtract(topLeftL);
        m.moveTo(pt.x + r, pt.y);
        m.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      };

      m.beginPath();
      // Если видимая область маленькая — перебираем её ячейки; иначе перебираем открытые ячейки.
      const estVisible = (rowMax - rowMin) * ((ne.lng - sw.lng) / cellColWidthDeg(rowMin));
      if (estVisible < fog.cells.size) {
        for (let row = rowMin; row <= rowMax; row++) {
          const cw = cellColWidthDeg(row);
          const colMin = Math.floor(sw.lng / cw) - 1;
          const colMax = Math.floor(ne.lng / cw) + 1;
          for (let col = colMin; col <= colMax; col++) {
            if (fog.cells.has(row + ":" + col)) drawCell(row, col);
          }
        }
      } else {
        for (const k of fog.cells) {
          const i = k.indexOf(":");
          const row = +k.slice(0, i);
          if (row < rowMin || row > rowMax) continue;
          drawCell(row, +k.slice(i + 1));
        }
      }
      m.fill();

      // --- сам туман ---
      const ctx = cv.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = this._pattern ? ctx.createPattern(this._pattern, "repeat") : "rgb(9,12,17)";
      ctx.fillRect(0, 0, cv.width, cv.height);

      ctx.globalCompositeOperation = "destination-out";
      const blur = Math.max(2, r * 0.8) * dpr;
      if ("filter" in ctx) ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(mask, 0, 0);
      if ("filter" in ctx) ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";

      L.DomUtil.setTransform(cv, topLeftL, 1);
    },
  });
  return new FogLayer({ pane: "fogPane" });
}

/** Шумовая текстура тумана — чтобы он был «дымным», а не плоской заливкой. */
function makeFogPattern() {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const img = g.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const n = Math.random() * 10;
    img.data[i * 4] = 9 + n;
    img.data[i * 4 + 1] = 12 + n;
    img.data[i * 4 + 2] = 18 + n * 1.3;
    img.data[i * 4 + 3] = 255; // непрозрачный: сквозь туман не должны проступать улицы
  }
  g.putImageData(img, 0, 0);
  return c;
}
