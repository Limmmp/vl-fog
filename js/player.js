// Игрок: позиция, режимы передвижения (симуляция / GPS), маркер на карте.

import { move, bearing, distance } from "./geo.js";
import { load, save, debounced } from "./storage.js";

const WALK = 1.5;     // м/с — шаг
const RUN_MULT = 4;   // Shift — бег/самокат
export const SIM_SPEEDUP = 8; // в симуляции игровое время ускорено, чтобы не ходить по 10 минут
const GPS_MAX_ACCURACY = 60; // м — хуже этого фиксы игнорируем

// Старт по умолчанию — Центральная площадь Владивостока
export const DEFAULT_START = { lat: 43.1155, lon: 131.8855 };

export class Player {
  constructor(map) {
    this.map = map;
    this.pos = load("player", DEFAULT_START);
    this.heading = 0;
    this.mode = "sim"; // 'sim' | 'gps'
    this.keys = new Set();
    this.walkTarget = null;
    this.listeners = [];
    this._gpsWatch = null;
    this._persist = debounced(() => save("player", this.pos), 1000);

    this.marker = L.marker([this.pos.lat, this.pos.lon], {
      icon: L.divIcon({
        className: "player-marker",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        html: `<svg viewBox="0 0 28 28" aria-label="Игрок"><path d="M14 2 L24 25 L14 19 L4 25 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>`,
      }),
      zIndexOffset: 1000,
      keyboard: false,
      interactive: false,
    }).addTo(map);

    this._bindKeys();
    map.on("click", (e) => {
      if (this.mode === "sim") this.walkTarget = { lat: e.latlng.lat, lon: e.latlng.lng };
    });
  }

  /** Во сколько раз игровое время быстрее реального (для таймеров и NPC). */
  get timeScale() {
    return this.mode === "sim" ? SIM_SPEEDUP : 1;
  }

  onMove(fn) {
    this.listeners.push(fn);
  }

  _bindKeys() {
    const map = {
      KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down",
      KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
      ShiftLeft: "run", ShiftRight: "run",
    };
    addEventListener("keydown", (e) => {
      if (e.target.closest("input, select, textarea")) return;
      const k = map[e.code];
      if (!k) return;
      this.keys.add(k);
      if (k !== "run") this.walkTarget = null;
      if (e.code.startsWith("Arrow")) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(map[e.code]));
    addEventListener("blur", () => this.keys.clear());
  }

  /** Вызывается игровым циклом. dt — секунды. */
  tick(dt) {
    if (this.mode !== "sim") return;
    const speed = WALK * (this.keys.has("run") ? RUN_MULT : 1);
    let dx = 0, dy = 0;
    if (this.keys.has("up")) dy += 1;
    if (this.keys.has("down")) dy -= 1;
    if (this.keys.has("right")) dx += 1;
    if (this.keys.has("left")) dx -= 1;

    if (dx || dy) {
      const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
      this._setPos(move(this.pos, deg, speed * dt * SIM_SPEEDUP), deg);
    } else if (this.walkTarget) {
      const d = distance(this.pos, this.walkTarget);
      const step = speed * dt * SIM_SPEEDUP;
      if (d <= step) {
        this._setPos(this.walkTarget, this.heading);
        this.walkTarget = null;
      } else {
        const deg = bearing(this.pos, this.walkTarget);
        this._setPos(move(this.pos, deg, step), deg);
      }
    }
  }

  teleport(p) {
    this._setPos(p, this.heading, true);
  }

  _setPos(p, heading, jump = false) {
    const prev = this.pos;
    this.pos = { lat: p.lat, lon: p.lon };
    this.heading = heading ?? this.heading;
    this.marker.setLatLng([p.lat, p.lon]);
    const svg = this.marker.getElement()?.querySelector("svg");
    if (svg) svg.style.transform = `rotate(${this.heading}deg)`;
    this._persist();
    this.listeners.forEach((fn) => fn(this.pos, prev, jump));
  }

  /** Переключить режим. Возвращает промис с итоговым режимом. */
  async setMode(mode) {
    if (mode === "gps") {
      if (!("geolocation" in navigator)) throw new Error("Браузер не поддерживает геолокацию");
      if (!window.isSecureContext) throw new Error("GPS работает только по https или на localhost");
      this.walkTarget = null;
      await new Promise((resolve, reject) => {
        let first = true;
        this._gpsWatch = navigator.geolocation.watchPosition(
          (p) => {
            const { latitude: lat, longitude: lon, accuracy, heading } = p.coords;
            if (accuracy > GPS_MAX_ACCURACY && !first) return;
            const h = Number.isFinite(heading) ? heading : bearing(this.pos, { lat, lon });
            this._setPos({ lat, lon }, h, first);
            if (first) { first = false; resolve(); }
          },
          (err) => {
            if (first) reject(new Error(gpsError(err)));
          },
          { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
        );
      });
      this.mode = "gps";
    } else {
      if (this._gpsWatch != null) navigator.geolocation.clearWatch(this._gpsWatch);
      this._gpsWatch = null;
      this.mode = "sim";
    }
    return this.mode;
  }
}

function gpsError(err) {
  if (err.code === 1) return "Доступ к геолокации запрещён — разреши его в настройках браузера";
  if (err.code === 2) return "Не удалось определить позицию";
  if (err.code === 3) return "GPS не ответил вовремя — попробуй на улице";
  return err.message || "Ошибка GPS";
}
