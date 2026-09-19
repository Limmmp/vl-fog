// Квестовый движок: метки-выдачи на карте, активное задание, шаги, награды.

import { distance, formatDistance } from "../geo.js";
import { walkRoute } from "../route.js";
import { load, save } from "../storage.js";
import { ui } from "../ui.js";
import { resolveQuest } from "./schema.js";
import { generateFromTemplates } from "./templates.js";
import { STORY } from "./story-vladivostok.js";
import { generateWithOllama } from "./ollama.js";

const OFFER_RADIUS = 35;       // м — подойди к метке, чтобы получить задание
const MAX_TEMPLATE_OFFERS = 3;
const OFFER_DROP_DIST = 1800;  // м — дальние случайные метки исчезают
const TAIL_LOSE = 170, TAIL_WARN = 120, TAIL_CLOSE = 12, TAIL_START = 150;
const REP_STARS = [2, 6, 12, 20, 32];

export class QuestEngine {
  constructor({ map, pois, fog, player, settings }) {
    Object.assign(this, { map, pois, fog, player, settings });
    this.state = load("quests", { cash: 0, rep: 0, done: [], storyDone: [] });
    this.offers = [];     // { quest, marker, declined }
    this.active = null;   // { quest, i, st, markers, line }
    this.generating = false;
    this.target = null;   // текущая цель для линии, радара и стрелки у края экрана
    this._offerClock = 4; // первые метки — через пару секунд после старта
    this._refreshHud(false);
  }

  // ---------- публичное ----------

  tick(dt) {
    const gdt = dt * this.player.timeScale; // игровое время
    this._offerClock -= dt;
    if (this._offerClock <= 0) {
      this._offerClock = 2.5;
      this._maintainOffers();
    }
    this._checkOfferProximity();
    if (this.active) this._updateStep(gdt);
  }

  reset() {
    this._clearActive();
    this.offers.forEach((o) => o.marker.remove());
    this.offers = [];
    this.state = { cash: 0, rep: 0, done: [], storyDone: [] };
    this._save();
    this._refreshHud(false);
  }

  /** Начислить награду не за задание (например, за открытие района). */
  grant(cash, rep = 0) {
    this.state.cash += cash;
    this.state.rep += rep;
    this._save();
    this._refreshHud(true);
  }

  /** Метки для радара: { lat, lon, kind }, kind — offer | story | target | tail. */
  radarBlips() {
    const out = this.offers.map((o) => ({ lat: o.quest.start.lat, lon: o.quest.start.lon, kind: o.quest.source === "story" ? "story" : "offer" }));
    for (const m of this.active?.markers || []) {
      const ll = m.getLatLng();
      out.push({ lat: ll.lat, lon: ll.lng, kind: m._kind });
    }
    return out;
  }

  /** Куда вести игрока: цель активного шага, а без задания — ближайшая метка-выдача. */
  guideTarget() {
    if (this.active) return this.target ? { ...this.target, kind: "target" } : null;
    const p = this.player.pos;
    let best = null, bd = Infinity;
    for (const o of this.offers) {
      const d = distance(p, o.quest.start);
      if (d < bd) { bd = d; best = o.quest.start; }
    }
    return best ? { lat: best.lat, lon: best.lon, kind: "offer" } : null;
  }

  logData() {
    return {
      active: this.active?.quest || null,
      done: this.state.done,
    };
  }

  // ---------- метки-выдачи ----------

  async _maintainOffers() {
    const p = this.player.pos;

    // Сюжетные миссии: всегда видны, если открыты
    for (const s of STORY) {
      if (this.state.storyDone.includes(s.storyId)) continue;
      if (!s.requires.every((r) => this.state.storyDone.includes(r))) continue;
      if (this.active?.quest.storyId === s.storyId) continue;
      if (this.offers.some((o) => o.quest.storyId === s.storyId)) continue;
      try {
        this._addOffer(resolveQuest(s, this.pois, "story"));
      } catch (e) {
        console.warn("[story]", e);
      }
    }

    // Случайные метки далеко от игрока — убираем
    for (const o of [...this.offers]) {
      if (o.quest.source !== "story" && distance(p, o.quest.start) > OFFER_DROP_DIST) this._removeOffer(o);
    }

    const randomCount = this.offers.filter((o) => o.quest.source !== "story").length;
    if (randomCount >= MAX_TEMPLATE_OFFERS || this.generating) return;

    this.generating = true;
    try {
      const q = await this._generate();
      if (q && !this.offers.some((o) => o.quest.start.id === q.start.id || o.quest.title === q.title)) this._addOffer(q);
    } finally {
      this.generating = false;
    }
  }

  async _generate() {
    const ctx = {
      player: this.player.pos,
      pois: this.pois,
      rnd: Math.random,
      done: this.state.done,
      nearby: this.pois.near(this.player.pos, 1200),
    };
    if (this.settings.provider === "ollama") {
      try {
        const raw = await generateWithOllama(this.settings, ctx);
        return resolveQuest(raw, this.pois, "ollama");
      } catch (e) {
        console.warn("[ollama]", e);
        if (!this._ollamaWarned) {
          ui.toast("Локальная модель не ответила — использую встроенные сюжеты", 4000);
          this._ollamaWarned = true;
        }
      }
    }
    const raw = generateFromTemplates(ctx);
    if (!raw) return null;
    try {
      return resolveQuest(raw, this.pois, "template");
    } catch (e) {
      console.warn("[template]", e);
      return null;
    }
  }

  _addOffer(quest) {
    const marker = blip(quest.start, "offer", quest.giver[0]).addTo(this.map);
    marker.bindTooltip(() => `${quest.title} · ${formatDistance(distance(this.player.pos, quest.start))}`, { direction: "top", offset: [0, -12] });
    this.offers.push({ quest, marker, declined: false });
  }

  _removeOffer(o) {
    o.marker.remove();
    this.offers = this.offers.filter((x) => x !== o);
  }

  async _checkOfferProximity() {
    if (this.active || ui.offerOpen) return;
    const p = this.player.pos;
    for (const o of this.offers) {
      const d = distance(p, o.quest.start);
      if (o.declined) {
        if (d > OFFER_RADIUS * 2.5) o.declined = false;
        continue;
      }
      if (d <= OFFER_RADIUS) {
        const yes = await ui.offer(o.quest);
        if (yes && !this.active) {
          this._removeOffer(o);
          this._start(o.quest);
        } else {
          o.declined = true;
        }
        return;
      }
    }
  }

  // ---------- активное задание ----------

  _start(quest) {
    this.active = { quest, i: -1, st: {}, markers: [], line: null };
    this._nextStep();
  }

  _nextStep() {
    const a = this.active;
    a.markers.forEach((m) => m.remove());
    a.markers = [];
    a.i++;
    if (a.i >= a.quest.steps.length) return this._complete();

    const s = a.quest.steps[a.i];
    a.st = { t: 0 };
    switch (s.type) {
      case "goto":
      case "hold":
        a.markers.push(blip(s.poi, "target", "!").addTo(this.map));
        break;
      case "tail": {
        a.st.npc = { lat: s.from.lat, lon: s.from.lon };
        a.st.started = false;
        a.st.sus = 0;
        a.st.walked = 0;
        a.st.path = null; // NPC тронется, когда маршрут по улицам будет готов
        a.markers.push(blip(s.from, "tail", "◉").addTo(this.map));
        const step = a.i;
        walkRoute(s.from, s.to).then((path) => {
          if (this.active === a && a.i === step) a.st.path = path;
        });
        break;
      }
      case "collect":
        a.st.left = new Set(s.pois.map((p) => p.id));
        s.pois.forEach((p) => {
          const m = blip(p, "target", "$").addTo(this.map);
          m._poiId = p.id;
          a.markers.push(m);
        });
        break;
      case "explore":
        a.st.base = this.fog.cells.size;
        break;
    }
    if (s.say.length && s.type === "tail") ui.say(s.say);
    this._drawObjective();
  }

  _updateStep(gdt) {
    const a = this.active;
    const s = a.quest.steps[a.i];
    const p = this.player.pos;
    let target = null;

    switch (s.type) {
      case "goto": {
        target = s.poi;
        a.st.t += gdt;
        if (distance(p, s.poi) <= s.radius) {
          ui.say(s.say);
          return this._nextStep();
        }
        if (s.timeLimit && a.st.t > s.timeLimit) return this._fail("Не успел");
        break;
      }
      case "hold": {
        target = s.poi;
        if (distance(p, s.poi) <= s.radius) {
          if (a.st.t === 0) ui.say(s.say);
          a.st.t += gdt;
          if (a.st.t >= s.seconds) return this._nextStep();
        }
        break;
      }
      case "tail": {
        const npc = a.st.npc;
        const d = distance(p, npc);
        target = npc;
        if (!a.st.started) {
          if (d <= TAIL_START && a.st.path) {
            a.st.started = true;
            ui.toast("Цель двинулась. Держи дистанцию!");
          }
        } else {
          a.st.walked += s.speed * gdt;
          if (a.st.walked >= a.st.path.length) return this._nextStep();
          const moved = a.st.path.at(a.st.walked);
          a.st.npc = { lat: moved.lat, lon: moved.lon };
          a.markers[0].setLatLng([moved.lat, moved.lon]);
          if (d > TAIL_LOSE) return this._fail("Цель потеряна");
          if (d < TAIL_CLOSE) a.st.sus += gdt / this.player.timeScale;
          else a.st.sus = Math.max(0, a.st.sus - gdt / this.player.timeScale / 2);
          if (a.st.sus > 3) return this._fail("Тебя заметили");
        }
        break;
      }
      case "collect": {
        for (const m of [...a.markers]) {
          const poi = s.pois.find((x) => x.id === m._poiId);
          if (a.st.left.has(poi.id) && distance(p, poi) <= s.radius) {
            a.st.left.delete(poi.id);
            m.remove();
            a.markers = a.markers.filter((x) => x !== m);
            ui.toast(`Забрал: ${poi.name}`);
          }
        }
        if (!a.st.left.size) return this._nextStep();
        // ближайшая оставшаяся точка — для линии-подсказки
        target = s.pois.filter((x) => a.st.left.has(x.id)).sort((x, y) => distance(p, x) - distance(p, y))[0];
        break;
      }
      case "explore": {
        if (this.fog.cells.size - a.st.base >= s.cells) return this._nextStep();
        break;
      }
    }
    this.target = target;
    this._drawGuide(target);
    this._drawObjective();
  }

  _drawObjective() {
    const a = this.active;
    if (!a) return ui.objective(null);
    const s = a.quest.steps[a.i];
    const p = this.player.pos;
    const parts = [`Шаг ${a.i + 1}/${a.quest.steps.length}`];
    switch (s.type) {
      case "goto":
        parts.push(formatDistance(distance(p, s.poi)));
        if (s.timeLimit) {
          const left = Math.max(0, s.timeLimit - a.st.t);
          const txt = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
          parts.push(left < 30 ? `<span class="warn">${txt}</span>` : txt);
        }
        break;
      case "hold": {
        const inside = distance(p, s.poi) <= s.radius;
        parts.push(inside ? `${Math.floor(a.st.t)}/${s.seconds} с` : `Подойди ближе · ${formatDistance(distance(p, s.poi))}`);
        break;
      }
      case "tail": {
        const d = distance(p, a.st.npc);
        if (!a.st.started) parts.push(d <= TAIL_START && !a.st.path ? "Цель вот-вот двинется…" : `До цели ${formatDistance(d)}`);
        else if (d > TAIL_WARN) parts.push(`<span class="warn">Отстаёшь! ${formatDistance(d)}</span>`);
        else if (d < TAIL_CLOSE * 1.5) parts.push(`<span class="warn">Слишком близко!</span>`);
        else parts.push(`Дистанция ${formatDistance(d)}`);
        break;
      }
      case "collect":
        parts.push(`Осталось ${a.st.left.size}`);
        break;
      case "explore":
        parts.push(`${this.fog.cells.size - a.st.base}/${s.cells}`);
        break;
    }
    ui.objective(a.quest.title, s.text, parts.join(" · "));
  }

  _drawGuide(target) {
    const a = this.active;
    if (!target) {
      a.line?.remove();
      a.line = null;
      return;
    }
    const pts = [[this.player.pos.lat, this.player.pos.lon], [target.lat, target.lon]];
    if (!a.line) {
      a.line = L.polyline(pts, { color: "#f2c230", weight: 3, opacity: 0.75, dashArray: "2 8", interactive: false, pane: "guidePane" }).addTo(this.map);
    } else a.line.setLatLngs(pts);
  }

  _complete() {
    const q = this.active.quest;
    this.state.cash += q.reward.cash;
    this.state.rep += q.reward.rep;
    this.state.done.push({ id: q.id, title: q.title, giver: q.giver, cash: q.reward.cash, at: Date.now() });
    if (q.storyId) this.state.storyDone.push(q.storyId);
    this._save();
    this._clearActive();
    ui.banner("Миссия пройдена", `+$${q.reward.cash.toLocaleString("ru-RU")}`);
    ui.say(q.outro);
    this._refreshHud(true);
    this._offerClock = 0;
  }

  _fail(reason) {
    const q = this.active.quest;
    this._clearActive();
    ui.banner("Миссия провалена", reason, true);
    // Задание можно повторить — возвращаем метку
    this._addOffer(q);
    this.offers[this.offers.length - 1].declined = true;
  }

  _clearActive() {
    if (!this.active) return;
    this.active.markers.forEach((m) => m.remove());
    this.active.line?.remove();
    this.active = null;
    this.target = null;
    ui.objective(null);
  }

  _refreshHud(bump) {
    ui.setCash(this.state.cash, bump);
    ui.setRep(REP_STARS.filter((t) => this.state.rep >= t).length);
  }

  _save() {
    save("quests", this.state);
  }
}

function blip(p, kind, letter) {
  const m = L.marker([p.lat, p.lon], {
    icon: L.divIcon({ className: "", html: `<div class="blip blip--${kind}">${esc(letter)}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
    pane: "blipPane",
    keyboard: false,
  });
  m._kind = kind;
  return m;
}

function esc(t) {
  return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
