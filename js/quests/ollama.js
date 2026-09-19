// Генерация квестов локальной моделью через Ollama (http://localhost:11434).
//
// Чтобы браузер мог обращаться к Ollama, разреши CORS для адреса игры:
//   OLLAMA_ORIGINS="http://localhost:3000" ollama serve
// (или "*" для экспериментов).
//
// Модель получает список реальных мест вокруг игрока и обязана вернуть JSON
// в формате из schema.js. Всё, что не проходит проверку, отбрасывается,
// и игра откатывается на встроенный генератор.

import { CHARACTERS } from "./templates.js";
import { KIND_LABEL } from "../poi.js";

export function buildPrompt({ nearby, done, player }) {
  const places = nearby
    .slice(0, 40)
    .map((p) => `- id=${p.id} | ${p.name} | ${KIND_LABEL[p.kind] || p.kind} | ${Math.round(p.dist)} м`)
    .join("\n");
  const chars = Object.values(CHARACTERS).map((c) => `- ${c.name}: ${c.about}`).join("\n");
  const recent = done.slice(-5).map((q) => `- ${q.title}`).join("\n") || "- (пока ничего)";

  return `Ты — сценарист уличной игры в духе GTA, действие во Владивостоке, реальные улицы.
Тон: ироничный, живой, немного криминальной романтики, без насилия и без инструкций к реальным преступлениям.
Игрок ходит пешком. Придумай ОДНО короткое задание, используя ТОЛЬКО места из списка (по их id).

Места рядом с игроком:
${places}

Персонажи-заказчики (можно придумать нового):
${chars}

Недавно пройденные задания (не повторяйся):
${recent}

Типы шагов:
- goto: {"type":"goto","poi":ID,"text":"...","say":["Имя: реплика"],"timeLimit":секунды_или_0}
- hold: {"type":"hold","poi":ID,"seconds":10-60,"text":"..."}
- tail: {"type":"tail","from":ID,"to":ID,"text":"..."}  (слежка за NPC, расстояние 300-800 м)
- collect: {"type":"collect","pois":[ID,ID,ID],"text":"..."}
- explore: {"type":"explore","cells":40-150,"text":"..."}

Ответь ТОЛЬКО JSON без пояснений:
{"title":"...","giver":"...","start":ID,"intro":"1-3 предложения от лица заказчика","reward":{"cash":100-2000,"rep":1-3},"steps":[1-4 шага],"outro":["Имя: реплика"]}
Точка start должна быть в 100-700 м от игрока, шаги — в пределах 1.2 км.`;
}

export async function generateWithOllama(settings, ctx) {
  const url = settings.ollamaUrl.replace(/\/$/, "") + "/api/generate";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.ollamaModel,
        prompt: buildPrompt(ctx),
        format: "json",
        stream: false,
        options: { temperature: 0.9 },
      }),
    });
    if (!res.ok) throw new Error("Ollama HTTP " + res.status);
    const data = await res.json();
    return JSON.parse(data.response);
  } finally {
    clearTimeout(timer);
  }
}
