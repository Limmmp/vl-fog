// Шаблонные квесты: механика фиксирована, места и детали подставляются из реальных точек вокруг игрока.
// Тексты и персонажи написаны Claude как стартовый набор; их легко дополнять.

import { distance } from "../geo.js";

export const CHARACTERS = {
  gosha:  { name: "Дядя Гоша",     about: "старый контрабандист с Миллионки, говорит загадками, помнит 90-е" },
  liza:   { name: "Лиза «Волна»",  about: "велокурьер, вечно опаздывает, дерзкая и весёлая" },
  krab:   { name: "Артём Краб",    about: "торгует крабом «с чёрного хода», параноик" },
  kenji:  { name: "Кэндзи",        about: "перегонщик праворульных японок с Зелёного угла, мешает русский и японский" },
  somov:  { name: "Капитан Сомов", about: "отставной моряк, картограф-любитель, ворчит про туман" },
  nina:   { name: "Нина из ларька",about: "знает все сплетни района, ревнивая" },
  syoma:  { name: "Сёма Хайп",     about: "блогер-миллионник (по его словам), охотится за кадрами" },
  vera:   { name: "Баба Вера",     about: "пенсионерка, у неё снова сбежал кот Адмирал" },
};

const pickOne = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

/** Выбрать точку нужных категорий на расстоянии [min, max] от origin, не из exclude. */
function pick(ctx, kinds, origin, min, max, exclude = []) {
  const ex = new Set(exclude.map((p) => p.id));
  const list = ctx.pois.near(origin, max, (p) => (!kinds || kinds.includes(p.kind)) && !ex.has(p.id))
    .filter((p) => p.dist >= min);
  return list.length ? pickOne(list, ctx.rnd) : null;
}

/** Время на дорогу пешком с запасом, в секундах. */
const walkTime = (a, b, slack = 1.6) => Math.round((distance(a, b) / 1.4) * slack + 45);

export const TEMPLATES = [
  // 1. Курьерская доставка на время
  {
    id: "courier",
    build(ctx) {
      const start = pick(ctx, ["food", "bar"], ctx.player, 80, 700);
      if (!start) return null;
      const dest = pick(ctx, null, start, 250, 900, [start]);
      if (!dest) return null;
      const g = CHARACTERS.liza.name;
      const cargo = pickOne(["пакет с пянсе", "термосумку с рамёном", "коробку пирожных «Птичье молоко»", "сорок порций хе из рыбы", "чей-то забытый зонт"], ctx.rnd);
      const t = walkTime(start, dest);
      return {
        title: "Горячая доставка",
        giver: g,
        start: start.id,
        intro: `${g}: «Цепь слетела, а у меня ${cargo} остывает. Точка — «${dest.name}». Уложишься в ${Math.ceil(t / 60)} мин — чаевые твои».`,
        reward: { cash: 150 + Math.round(distance(start, dest) / 3), rep: 1 },
        steps: [
          { type: "goto", poi: dest.id, timeLimit: t, text: `Доставь ${cargo} к «${dest.name}»`,
            say: [`Клиент: Наконец-то! Я уже думал, вы через Русский мост пешком шли.`] },
        ],
        outro: [`${g}: Красавчик! Если что — у меня ещё полгорода заказов.`],
      };
    },
  },

  // 2. Слежка
  {
    id: "tail",
    build(ctx) {
      const start = pick(ctx, ["shop", "food", "misc", "landmark"], ctx.player, 80, 700);
      if (!start) return null;
      const a = pick(ctx, ["food", "bar", "shop"], start, 120, 450, [start]);
      if (!a) return null;
      const b = pick(ctx, ["park", "water", "view", "landmark", "bar"], a, 300, 800, [start, a]);
      if (!b) return null;
      const g = CHARACTERS.nina.name;
      return {
        title: "Куда он ходит по вечерам",
        giver: g,
        start: start.id,
        intro: `${g}: «Мой Толик опять «к другу в гараж». Он сейчас у «${a.name}». Проследи, куда пойдёт. Только не спались — он пугливый».`,
        reward: { cash: 400, rep: 2 },
        steps: [
          { type: "goto", poi: a.id, text: `Найди Толика у «${a.name}»` },
          { type: "tail", from: a.id, to: b.id, text: "Следуй за Толиком. Не отставай и не подходи слишком близко" },
          { type: "hold", poi: b.id, seconds: 15, text: "Понаблюдай, с кем он встречается",
            say: ["Толик: …да я ж говорю, лучший чебурек в городе, только Нине не говори!"] },
        ],
        outro: [`${g}: Чебуреки?! Ну я ему устрою «гараж». Держи, заслужил.`],
      };
    },
  },

  // 3. Сбор нескольких точек
  {
    id: "crab",
    build(ctx) {
      const start = pick(ctx, ["water", "shop", "food"], ctx.player, 80, 700);
      if (!start) return null;
      const pts = [];
      for (let i = 0; i < 3; i++) {
        const p = pick(ctx, ["shop", "food", "water", "misc", "auto"], start, 150, 800, [start, ...pts]);
        if (p) pts.push(p);
      }
      if (pts.length < 2) return null;
      const g = CHARACTERS.krab.name;
      return {
        title: "Краб-экспресс",
        giver: g,
        start: start.id,
        intro: `${g}: «Тс-с. Мои ребята раскидали ящики по точкам — рыбнадзор на хвосте. Собери всё, пока не хватились. Никаких вопросов».`,
        reward: { cash: 250 * pts.length, rep: 2 },
        steps: [
          { type: "collect", pois: pts.map((p) => p.id), text: `Забери ящики: ${pts.map((p) => "«" + p.name + "»").join(", ")}` },
          { type: "goto", poi: start.id, text: "Верни улов Артёму", timeLimit: 600 },
        ],
        outro: [`${g}: Все клешни на месте. Ты ничего не видел, я ничего не давал.`],
      };
    },
  },

  // 4. Праворульная тайна: дойти, подождать, уйти
  {
    id: "kenji",
    build(ctx) {
      const start = pick(ctx, ["auto", "shop", "misc", "food"], ctx.player, 80, 700);
      if (!start) return null;
      const meet = pick(ctx, ["park", "landmark", "water", "view"], start, 250, 900, [start]);
      if (!meet) return null;
      const g = CHARACTERS.kenji.name;
      return {
        title: "Документы на «Марк II»",
        giver: g,
        start: start.id,
        intro: `${g}: «Коннитива! Покупатель ждёт у «${meet.name}». Передай бумаги, постой, пока он проверит VIN. Только не торопи его — дзэн».`,
        reward: { cash: 600, rep: 2 },
        steps: [
          { type: "goto", poi: meet.id, text: `Встреться с покупателем у «${meet.name}»` },
          { type: "hold", poi: meet.id, seconds: 25, text: "Жди, пока покупатель сверяет номер кузова",
            say: ["Покупатель: Пробег 40 тысяч? Ну-ну. Ладно, беру."] },
        ],
        outro: [`${g}: Аригато! Будет тебе скидка на тонировку.`],
      };
    },
  },

  // 5. Разведка тумана
  {
    id: "somov",
    build(ctx) {
      const start = pick(ctx, ["water", "view", "park", "landmark"], ctx.player, 80, 900);
      if (!start) return null;
      const cells = pickOne([60, 80, 120], ctx.rnd);
      const g = CHARACTERS.somov.name;
      const km2 = ((cells * 400) / 1e6).toFixed(2);
      return {
        title: "Белое пятно",
        giver: g,
        start: start.id,
        intro: `${g}: «Туман, салага, — он не над заливом, он в головах. Пройдись по кварталам, которых ещё не видел, открой мне ${km2} км² карты».`,
        reward: { cash: cells * 6, rep: 1 },
        steps: [{ type: "explore", cells, text: `Открой ${cells} новых участков карты (≈${km2} км²)` }],
        outro: [`${g}: Вот теперь карта похожа на карту. Держи на курево… то есть на мороженое.`],
      };
    },
  },

  // 6. Фотоохота
  {
    id: "syoma",
    build(ctx) {
      const start = pick(ctx, ["food", "bar", "culture", "misc"], ctx.player, 80, 700);
      if (!start) return null;
      const spot = pick(ctx, ["view", "landmark", "culture", "water", "park"], start, 200, 1000, [start]);
      if (!spot) return null;
      const g = CHARACTERS.syoma.name;
      return {
        title: "Контент сам себя не снимет",
        giver: g,
        start: start.id,
        intro: `${g}: «Братан, нужен кадр у «${spot.name}», пока свет золотой. Постоишь с телефоном 20 секунд — и ты в сторис на 300 тыщ… ну, на 3 тыщи».`,
        reward: { cash: 350, rep: 1 },
        steps: [
          { type: "goto", poi: spot.id, text: `Доберись до «${spot.name}»`, timeLimit: walkTime(start, spot, 2) },
          { type: "hold", poi: spot.id, seconds: 20, text: "Снимай! Не уходи из кадра" },
        ],
        outro: [`${g}: Огонь! Отмечу тебя. Наверное.`],
      };
    },
  },

  // 7. Потерянный кот
  {
    id: "vera",
    build(ctx) {
      const start = pick(ctx, ["shop", "park", "misc", "food"], ctx.player, 80, 700);
      if (!start) return null;
      const pts = [];
      for (let i = 0; i < 2; i++) {
        const p = pick(ctx, ["park", "food", "shop", "misc", "water"], start, 120, 600, [start, ...pts]);
        if (p) pts.push(p);
      }
      if (pts.length < 2) return null;
      const g = CHARACTERS.vera.name;
      return {
        title: "Адмирал в самоволке",
        giver: g,
        start: start.id,
        intro: `${g}: «Сынок, Адмирал опять удрал! Рыжий, толстый, отзывается на «кис-кис» и на шуршание пакета. Его видели у «${pts[0].name}»».`,
        reward: { cash: 200, rep: 2 },
        steps: [
          { type: "goto", poi: pts[0].id, text: `Проверь «${pts[0].name}»`, say: ["Дворник: Рыжий? Туда побежал, за ним собаки."] },
          { type: "tail", from: pts[0].id, to: pts[1].id, speed: 1.6, text: "Не упусти кота из виду!" },
          { type: "goto", poi: start.id, text: "Верни Адмирала хозяйке" },
        ],
        outro: [`${g}: Адмиральчик! Спасибо, родной, вот тебе на пирожки.`],
      };
    },
  },
];

/** Сгенерировать случайный шаблонный квест. */
export function generateFromTemplates(ctx, attempts = 8) {
  const pool = [...TEMPLATES];
  for (let i = 0; i < attempts && pool.length; i++) {
    const idx = Math.floor(ctx.rnd() * pool.length);
    const t = pool[idx];
    const q = t.build(ctx);
    if (q) return { ...q, templateId: t.id };
    pool.splice(idx, 1);
  }
  return null;
}
