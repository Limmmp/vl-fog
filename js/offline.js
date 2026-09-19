// PWA: регистрация service worker, установка на телефон, карта для офлайна, экран не гаснет в GPS-режиме.

/** Кэш карты (тайлы, спрайты, шрифты OpenFreeMap). Без версии — переживает обновления игры. */
export const MAP_CACHE = "vlfog-tiles";

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("[sw] не зарегистрирован", e));
}

/** Кнопка «Установить»: показываем, только когда браузер готов установить игру. */
export function setupInstallButton(btn, onInstalled) {
  let deferred = null;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  addEventListener("appinstalled", () => {
    btn.hidden = true;
    deferred = null;
    onInstalled?.();
  });
  btn.onclick = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    btn.hidden = true;
  };
}

/** Скачать список URL в кэш карты (для прогулок без связи). onProgress(done, total). */
export async function downloadUrls(urls, onProgress) {
  if (!("caches" in window)) throw new Error("Браузер не поддерживает офлайн-кэш");
  const cache = await caches.open(MAP_CACHE);
  let done = 0, failed = 0;
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { mode: "cors" });
          if (res.ok) await cache.put(url, res);
          else failed++;
        }
      } catch {
        failed++;
      }
      onProgress?.(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { total: urls.length, failed };
}

/** Не давать экрану гаснуть, пока включён GPS. Браузер снимает блокировку при сворачивании — возвращаем её. */
export function createWakeLock() {
  let lock = null;
  let wanted = false;
  const acquire = async () => {
    if (!wanted || lock || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => (lock = null));
    } catch {
      /* батарея/настройки не дали — не критично */
    }
  };
  document.addEventListener("visibilitychange", acquire);
  return {
    set(on) {
      wanted = on;
      if (on) acquire();
      else lock?.release();
    },
  };
}
