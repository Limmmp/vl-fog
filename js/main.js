// Точка входа: карта, туман, игрок, квесты, игровой цикл.

import { FogOfWar, createFogLayer } from "./fog.js";
import { Player } from "./player.js";
import { PoiService } from "./poi.js";
import { QuestEngine } from "./quests/engine.js";
import { DistrictService } from "./districts.js";
import { createRadar, createEdgeArrow } from "./radar.js";
import { registerServiceWorker, setupInstallButton, downloadUrls, createWakeLock } from "./offline.js";
import { createBasemap, hasWebGL, offlineUrls } from "./basemap.js";
import { ui } from "./ui.js";
import { load, save, clearAll } from "./storage.js";

// ---------- Карта ----------
const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
  minZoom: 12,
  maxZoom: 19,
  zoomSnap: 0.5,
});
// Свой префикс подписи: у Leaflet 1.9 в стандартном есть флаг, нам нужна только ссылка на библиотеку
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');

// Подложка: векторная карта OpenFreeMap (данные © OpenStreetMap), см. js/basemap.js.
// Подпись источника плагин добавляет сам из стиля.
if (hasWebGL()) createBasemap().then((layer) => layer.addTo(map)).catch((e) => console.error("[basemap]", e));

// Слои по высоте: тайлы (200) < туман (450) < линия маршрута (460) < метки (580) < игрок (600)
for (const [name, z] of [["fogPane", 450], ["guidePane", 460], ["blipPane", 580]]) {
  map.createPane(name).style.zIndex = z;
}
map.getPane("fogPane").style.pointerEvents = "none";
map.getPane("guidePane").style.pointerEvents = "none";

// ---------- Системы ----------
const settings = Object.assign(
  { provider: "builtin", ollamaUrl: "http://localhost:11434", ollamaModel: "qwen2.5:7b" },
  load("settings", {})
);
const fog = new FogOfWar();
const player = new Player(map);
const pois = new PoiService();
const quests = new QuestEngine({ map, pois, fog, player, settings });
const districts = new DistrictService(fog);

map.setView([player.pos.lat, player.pos.lon], 16.5);
createFogLayer(fog).addTo(map);

let follow = true;
map.on("dragstart", () => (follow = false));

player.onMove((pos, prev, jump) => {
  if (jump || !prev) fog.reveal(pos);
  else fog.revealPath(prev, pos);
  if (follow) map.panTo([pos.lat, pos.lon], { animate: false });
  pois.ensureAround(pos);
  districts.update(pos);
});
fog.onChange(() => ui.setExplored(fog.areaKm2()));

// ---------- Районы ----------
const showDistrict = () => {
  const d = districts.current;
  ui.setDistrict(d?.name, d ? districts.percent(d.id) : null, d && districts.isLoading(d.id));
};
let districtsReady = false; // при загрузке страницы не показываем заставку района
districts.on((type, d, m) => {
  if (type === "enter" && d && districtsReady) ui.areaName(d.name);
  if (type === "milestone") {
    quests.grant(m.cash, m.rep);
    ui.banner(m.pct >= 90 ? "Район открыт" : `${d.name}: ${m.pct}%`, `${d.name} · +$${m.cash.toLocaleString("ru-RU")}`);
  }
  showDistrict();
});

fog.reveal(player.pos);
ui.setExplored(fog.areaKm2());
pois.ensureAround(player.pos);
districts.update(player.pos);
districtsReady = true;

// ---------- Кнопки ----------
const $ = (id) => document.getElementById(id);
if (!hasWebGL()) ui.toast("Браузер не умеет WebGL — карта будет без подложки, только туман и метки", 6000);

$("btn-mode").onclick = async () => {
  const btn = $("btn-mode");
  const next = player.mode === "sim" ? "gps" : "sim";
  btn.disabled = true;
  if (next === "gps") btn.textContent = "Ищу GPS…";
  try {
    await player.setMode(next);
    wakeLock.set(player.mode === "gps");
    follow = true;
    map.setView([player.pos.lat, player.pos.lon], Math.max(map.getZoom(), 16.5));
    ui.toast(next === "gps" ? "GPS включён. Иди гулять!" : "Режим симуляции");
  } catch (e) {
    ui.toast(e.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = player.mode === "gps" ? "Режим: GPS" : "Режим: симуляция";
    btn.classList.toggle("is-gps", player.mode === "gps");
  }
};

const centerOnPlayer = () => {
  follow = true;
  map.setView([player.pos.lat, player.pos.lon], Math.max(map.getZoom(), 16));
};
$("btn-center").onclick = centerOnPlayer;

const openPanel = () => {
  const d = quests.logData();
  ui.renderLog(d.active, d.done);
  ui.renderDistricts(districts.summary(), districts.current?.id);
  $("panel").hidden = false;
};
$("btn-log").onclick = openPanel;
$("panel-close").onclick = () => ($("panel").hidden = true);
addEventListener("keydown", (e) => {
  if (e.code === "Escape") $("panel").hidden = true;
  if (e.code === "KeyJ" && !e.target.closest("input, select")) openPanel();
});

// Настройки генератора
$("set-provider").value = settings.provider;
$("set-ollama-url").value = settings.ollamaUrl;
$("set-ollama-model").value = settings.ollamaModel;
const saveSettings = () => {
  settings.provider = $("set-provider").value;
  settings.ollamaUrl = $("set-ollama-url").value.trim();
  settings.ollamaModel = $("set-ollama-model").value.trim();
  save("settings", settings);
};
["set-provider", "set-ollama-url", "set-ollama-model"].forEach((id) => ($(id).onchange = saveSettings));

$("btn-reveal-debug").onclick = () => fog.reveal(player.pos, 300);
$("btn-reset").onclick = () => {
  if (!confirm("Стереть карту, деньги и пройденные задания?")) return;
  fog.reset();
  quests.reset();
  districts.reset();
  clearAll();
  fog.reveal(player.pos);
  $("panel").hidden = true;
};

// ---------- PWA ----------
registerServiceWorker();
setupInstallButton($("btn-install"), () => ui.toast("Игра установлена — ищи её на главном экране"));
const wakeLock = createWakeLock();

$("btn-offline").onclick = async () => {
  const btn = $("btn-offline");
  btn.disabled = true;
  try {
    const urls = await offlineUrls(player.pos, 1000);
    const res = await downloadUrls(urls, (done, total) => {
      btn.textContent = `Сохраняю… ${done}/${total}`;
    });
    ui.toast(res.failed ? `Сохранено ${res.total - res.failed} из ${res.total} файлов — часть не скачалась` : "Карта вокруг сохранена для офлайна", 4000);
  } catch (e) {
    ui.toast(e.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = "Сохранить карту в радиусе 1 км";
  }
};

// ---------- Радар и стрелка ----------
const radar = createRadar({ canvas: $("radar"), fog, player, quests, onClick: centerOnPlayer });
const edgeArrow = createEdgeArrow({ el: $("edge-arrow"), map, player, quests, avoid: $("radar") });

// ---------- Игровой цикл ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  player.tick(dt);
  quests.tick(dt);
  radar.tick(now);
  edgeArrow.tick(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Первое знакомство
if (!load("seenIntro", false)) {
  ui.say([
    "Владивосток. Туман пришёл с залива и забрал с собой всю карту.",
    "Жёлтые метки — люди, у которых есть для тебя работа. Иди к ним.",
    "Дядя Гоша ждёт на Центральной площади.",
  ]);
  save("seenIntro", true);
}

// Для отладки из консоли
window.game = { map, fog, player, pois, quests, districts, settings };
