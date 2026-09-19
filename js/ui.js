// Интерфейс: HUD, цель, субтитры, баннеры, карточка задания, журнал.

const $ = (id) => document.getElementById(id);
const formatPct = (v) => (v > 0 && v < 1 ? v.toFixed(1) : Math.floor(v)) + "%";

export const ui = {
  setCash(v, bump = false) {
    const el = $("hud-cash");
    el.textContent = "$" + v.toLocaleString("ru-RU");
    if (bump) {
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
    }
  },

  setExplored(km2) {
    $("hud-explored").textContent = km2.toFixed(km2 < 1 ? 3 : 2) + " км²";
  },

  setRep(stars) {
    $("hud-rep").textContent = "★".repeat(stars) + "☆".repeat(5 - stars);
  },

  /** Район в HUD. pct = null — улиц района ещё нет: грузятся («…») или не загрузились («—»). */
  setDistrict(name, pct, loading = false) {
    $("hud-district-row").hidden = !name;
    if (!name) return;
    $("hud-district").textContent = name;
    $("hud-district-pct").textContent = pct != null ? formatPct(pct) : loading ? "…" : "—";
  },

  /** Крупное название района при входе в него. */
  areaName(name) {
    const el = $("area-name");
    el.textContent = name;
    el.hidden = false;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(this._areaT);
    this._areaT = setTimeout(() => (el.hidden = true), 3500);
  },

  renderDistricts(list, currentId) {
    const box = $("log-districts");
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = '<div class="log__empty">Походи по городу — здесь появятся районы и их прогресс.</div>';
      return;
    }
    for (const d of list) {
      const div = document.createElement("div");
      div.className = "log__item district" + (d.id === currentId ? " active" : "");
      const head = document.createElement("div");
      head.className = "district__head";
      const name = document.createElement("span");
      name.textContent = d.name;
      const pct = document.createElement("b");
      pct.textContent = formatPct(d.pct);
      head.append(name, pct);
      const bar = document.createElement("div");
      bar.className = "district__bar";
      const fill = document.createElement("i");
      fill.style.width = Math.min(100, d.pct) + "%";
      bar.append(fill);
      div.append(head, bar);
      box.append(div);
    }
  },

  objective(title, text, meta = "") {
    const box = $("objective");
    if (!title) { box.hidden = true; return; }
    box.hidden = false;
    $("obj-title").textContent = title;
    $("obj-text").textContent = text;
    $("obj-meta").innerHTML = meta; // meta формируется только кодом движка
  },

  // --- Субтитры: очередь реплик ---
  _subs: [],
  _subTimer: null,
  say(lines) {
    const arr = Array.isArray(lines) ? lines : [lines];
    if (!arr.filter(Boolean).length) return;
    // Не копим длинный хвост старых реплик — новые события важнее
    if (this._subs.length > 1) this._subs = this._subs.slice(-1);
    this._subs.push(...arr.filter(Boolean));
    if (!this._subTimer) this._nextSub();
  },
  _nextSub() {
    const el = $("subtitle");
    const line = this._subs.shift();
    if (!line) { el.hidden = true; this._subTimer = null; return; }
    el.hidden = false;
    // Формат реплики: "Имя: текст" — имя подсвечиваем
    const m = /^([^:]{1,24}):\s(.+)$/.exec(line);
    el.textContent = "";
    if (m) {
      const b = document.createElement("b");
      b.textContent = m[1] + ": ";
      el.append(b, m[2]);
    } else {
      el.textContent = line;
    }
    const ms = Math.min(9000, 1800 + line.length * 55);
    this._subTimer = setTimeout(() => this._nextSub(), ms);
  },

  banner(big, small = "", fail = false) {
    const box = $("banner");
    const b = $("banner-big");
    b.textContent = big;
    b.classList.toggle("fail", fail);
    $("banner-small").textContent = small;
    box.hidden = false;
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => (box.hidden = true), 3200);
  },

  toast(text, ms = 3000) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (el.hidden = true), ms);
  },

  /** Показать предложение задания. Возвращает промис: true — взять, false — позже. */
  offer(q) {
    return new Promise((resolve) => {
      $("offer-giver").textContent = q.giver + (q.source === "story" ? " · сюжет" : q.source === "ollama" ? " · локальная модель" : "");
      $("offer-title").textContent = q.title;
      $("offer-intro").textContent = q.intro;
      $("offer-reward").textContent = `Награда: $${q.reward.cash.toLocaleString("ru-RU")} · +${q.reward.rep} уважения`;
      const box = $("offer");
      box.hidden = false;
      const done = (v) => {
        box.hidden = true;
        $("offer-accept").onclick = $("offer-decline").onclick = null;
        resolve(v);
      };
      $("offer-accept").onclick = () => done(true);
      $("offer-decline").onclick = () => done(false);
      $("offer-accept").focus();
    });
  },
  get offerOpen() {
    return !$("offer").hidden;
  },

  renderLog(active, done) {
    const a = $("log-active");
    const d = $("log-done");
    a.innerHTML = d.innerHTML = "";
    const item = (title, sub, cls) => {
      const div = document.createElement("div");
      div.className = "log__item " + (cls || "");
      div.textContent = title;
      if (sub) {
        const s = document.createElement("small");
        s.textContent = sub;
        div.append(s);
      }
      return div;
    };
    if (active) a.append(item(active.title, active.giver, "active"));
    else a.innerHTML = '<div class="log__empty">Нет активного задания. Ищи жёлтые метки на карте.</div>';
    if (!done.length) d.innerHTML = '<div class="log__empty">Пока пусто.</div>';
    done.slice().reverse().forEach((q) => d.append(item(q.title, `${q.giver} · $${q.cash}`)));
  },
};
