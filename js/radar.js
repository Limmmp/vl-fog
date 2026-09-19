// Радар в углу (как в GTA) и стрелка у края экрана, когда цель за его пределами.

import { CELL, cellOf, cellKey, cellCenter, cellColWidthDeg, offsetMeters, distance, formatDistance } from "./geo.js";

const RANGE = 350;    // м от центра до края радара
const REDRAW = 100;   // мс между перерисовками радара
const EDGE_INSET = { top: 76, right: 28, bottom: 76, left: 28 }; // отступы стрелки от краёв экрана, px

const BLIP_STYLE = {
  offer:  { fill: "#f2c230", r: 3.5, ring: false },
  story:  { fill: "#f2c230", r: 4.5, ring: true },
  target: { fill: "#f2c230", r: 5, ring: true, pulse: true },
  tail:   { fill: "#ff4d5a", r: 4.5, ring: true },
};

export function createRadar({ canvas, fog, player, quests, onClick }) {
  const ctx = canvas.getContext("2d");
  let last = 0;
  let size = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = canvas.clientWidth;
    canvas.width = canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  addEventListener("resize", resize);
  resize();
  if (onClick) canvas.addEventListener("click", onClick);

  function draw(now) {
    if (!size) return;
    const p = player.pos;
    const c = size / 2;
    const k = (c - 2) / RANGE; // px на метр

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.clip();

    // Туман и открытые ячейки
    ctx.fillStyle = "#0b0f15";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#3b4756";
    const cs = CELL * k + 0.6; // чуть внахлёст, чтобы не было швов
    const rows = Math.ceil(RANGE / CELL) + 1;
    const { row: r0 } = cellOf(p);
    for (let r = r0 - rows; r <= r0 + rows; r++) {
      const c0 = Math.floor(p.lon / cellColWidthDeg(r));
      for (let col = c0 - rows; col <= c0 + rows; col++) {
        if (!fog.cells.has(cellKey(r, col))) continue;
        const o = offsetMeters(p, cellCenter(r, col));
        ctx.fillRect(c + o.x * k - cs / 2, c - o.y * k - cs / 2, cs, cs);
      }
    }

    // Кольцо на половине дальности
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, c / 2, 0, Math.PI * 2);
    ctx.stroke();

    // Метки: за пределами дальности прижимаем к краю
    const blips = quests.radarBlips();
    const order = ["offer", "story", "target", "tail"];
    blips.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    for (const b of blips) {
      const st = BLIP_STYLE[b.kind] || BLIP_STYLE.offer;
      const o = offsetMeters(p, b);
      const d = Math.hypot(o.x, o.y);
      const maxPx = c - st.r - 3;
      let x = o.x * k, y = -o.y * k;
      const far = d * k > maxPx;
      if (far) { x = (x / (d * k)) * maxPx; y = (y / (d * k)) * maxPx; }
      let r = far ? st.r * 0.8 : st.r;
      if (st.pulse) r += Math.sin(now / 180) * 0.8;
      ctx.beginPath();
      ctx.arc(c + x, c + y, r, 0, Math.PI * 2);
      ctx.fillStyle = st.fill;
      ctx.fill();
      if (st.ring) {
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Игрок — стрелка по курсу
    ctx.translate(c, c);
    ctx.rotate((player.heading * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Север
    ctx.font = "700 10px Rubik, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#9aa6b2";
    ctx.fillText("С", c, 9);
  }

  return {
    tick(now) {
      if (now - last < REDRAW) return;
      last = now;
      draw(now);
    },
  };
}

/** Стрелка у края экрана, указывающая на цель вне видимой области. */
export function createEdgeArrow({ el, map, player, quests, avoid }) {
  const icon = el.querySelector(".edge-arrow__icon");
  const label = el.querySelector(".edge-arrow__dist");
  let last = 0;

  function update() {
    const t = quests.guideTarget();
    if (!t) { el.hidden = true; return; }
    const size = map.getSize();
    const pt = map.latLngToContainerPoint([t.lat, t.lon]);
    const l = EDGE_INSET.left, r = size.x - EDGE_INSET.right;
    const top = EDGE_INSET.top, b = size.y - EDGE_INSET.bottom;
    if (pt.x >= l && pt.x <= r && pt.y >= top && pt.y <= b) { el.hidden = true; return; }

    // Луч из центра экрана к цели, пересечение с рамкой отступов
    const cx = size.x / 2, cy = size.y / 2;
    const dx = pt.x - cx, dy = pt.y - cy;
    const s = Math.min(
      dx > 0 ? (r - cx) / dx : dx < 0 ? (l - cx) / dx : Infinity,
      dy > 0 ? (b - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity
    );
    let x = cx + dx * s, y = cy + dy * s;

    // Радар в углу — препятствие: сдвигаем стрелку вдоль того же края экрана, пока она не выйдет из-под него
    if (avoid) {
      const rr = avoid.getBoundingClientRect();
      const m = 22;
      if (x > rr.left - m && x < rr.right + m && y > rr.top - m && y < rr.bottom + m) {
        const onSide = x <= l + 0.5 || x >= r - 0.5; // левый/правый край — двигаем по вертикали
        if (onSide) y = rr.top - m;
        else x = rr.left > size.x / 2 ? rr.left - m : rr.right + m;
      }
    }

    el.hidden = false;
    el.classList.toggle("edge-arrow--offer", t.kind === "offer");
    el.style.transform = `translate(${x}px, ${y}px)`;
    icon.style.transform = `rotate(${(Math.atan2(dx, -dy) * 180) / Math.PI}deg)`;
    label.textContent = formatDistance(distance(player.pos, t));
  }

  return {
    tick(now) {
      if (now - last < 66) return;
      last = now;
      update();
    },
  };
}
