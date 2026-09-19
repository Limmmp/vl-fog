// Формат квеста — общий контракт для всех генераторов (шаблоны, сюжеты, локальная модель).
//
// «Сырой» квест (то, что выдаёт генератор; точки указаны по id из PoiService):
// {
//   "title":  "Краб-экспресс",
//   "giver":  "Артём Краб",
//   "start":  "n123456",                 // где стоит метка-выдача (id точки)
//   "intro":  "Текст предложения, 1–3 предложения",
//   "reward": { "cash": 800, "rep": 2 },
//   "steps": [
//     { "type": "goto",    "poi": "n1", "text": "Иди к …", "say": ["Имя: реплика"], "timeLimit": 300 },
//     { "type": "hold",    "poi": "n2", "seconds": 30, "text": "Жди у …" },
//     { "type": "tail",    "from": "n3", "to": "n4", "text": "Проследи за …" },
//     { "type": "collect", "pois": ["n5","n6","n7"], "text": "Собери …" },
//     { "type": "explore", "cells": 60, "text": "Разведай район" }
//   ],
//   "outro":  "Реплика по завершении"
// }
//
// resolveQuest() превращает id в объекты точек и проверяет, что всё валидно.

export const STEP_TYPES = ["goto", "hold", "tail", "collect", "explore"];

let seq = 0;

export function resolveQuest(raw, pois, source = "template") {
  const P = (id) => {
    const p = typeof id === "object" && id ? id : pois.get(id);
    if (!p) throw new Error(`Неизвестная точка: ${id}`);
    return { id: p.id, name: p.name, lat: p.lat, lon: p.lon, kind: p.kind };
  };
  if (!raw || typeof raw !== "object") throw new Error("Квест не объект");
  if (!raw.title || !Array.isArray(raw.steps) || !raw.steps.length) throw new Error("Нет title или steps");

  const steps = raw.steps.map((s, i) => {
    if (!STEP_TYPES.includes(s.type)) throw new Error(`Шаг ${i}: неизвестный тип ${s.type}`);
    const base = { type: s.type, text: String(s.text || ""), say: toLines(s.say) };
    switch (s.type) {
      case "goto":
        return { ...base, poi: P(s.poi), radius: s.radius || 35, timeLimit: num(s.timeLimit) };
      case "hold":
        return { ...base, poi: P(s.poi), radius: s.radius || 35, seconds: clamp(num(s.seconds) || 20, 5, 600) };
      case "tail":
        return { ...base, from: P(s.from), to: P(s.to), speed: s.speed || 1.3 };
      case "collect": {
        const list = (s.pois || []).map(P);
        if (!list.length) throw new Error(`Шаг ${i}: пустой collect`);
        return { ...base, pois: list, radius: s.radius || 30 };
      }
      case "explore":
        return { ...base, cells: clamp(num(s.cells) || 50, 10, 2000) };
    }
  });

  const start = raw.start ? P(raw.start) : steps[0].poi || steps[0].from || steps[0].pois?.[0];
  if (!start) throw new Error("Не определена точка выдачи");

  return {
    id: raw.id || `${source}-${Date.now().toString(36)}-${seq++}`,
    storyId: raw.storyId || null,
    source,
    title: String(raw.title).slice(0, 80),
    giver: String(raw.giver || "Незнакомец").slice(0, 40),
    intro: String(raw.intro || ""),
    outro: toLines(raw.outro),
    reward: {
      cash: clamp(Math.round(num(raw.reward?.cash) || 300), 0, 50000),
      rep: clamp(Math.round(num(raw.reward?.rep) || 1), 0, 10),
    },
    start,
    steps,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function toLines(v) {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).map(String).filter(Boolean);
}
