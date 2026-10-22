// Скидка на комплект из настроек: настоящие Settings.js и EquipLinks.js (equipDiscCfg_, equipDiscCalc_),
// и тот же расчёт в браузере (Kit.html, discCalc). Цены — как в боевом каталоге.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRICES = { 'Тренировочная форма': 100, 'Игровая форма': 200, 'Вратарская форма': 200, 'Носки': 15, 'Гетры': 20, 'Спортивный костюм': 170, 'Дождевик': 150 };
const LOW = Object.fromEntries(Object.entries(PRICES).map(([k, v]) => [k.toLowerCase(), v]));
const FULL = ['Дождевик', 'Тренировочная форма', 'Спортивный костюм', 'Игровая форма'];

function server(rows) {
  const settings = { data: [['Ключ', 'Объект', 'Значение', 'Изменено']].concat(rows || []) };
  settings.getLastRow = () => settings.data.length;
  settings.getRange = (r, c, n = 1, m = 1) => ({ getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => (settings.data[r - 1 + i] || [])[c - 1 + j] ?? '')),
    getDisplayValues() { return this.getValues().map(x => x.map(String)); } });
  const props = { SET_VER: '0' }, cache = {};
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, CONFIG: { DRY_RUN: false },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove() {} }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  for (const f of ['Settings.js', 'EquipLinks.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  ctx.dbRead_ = n => (n === 'НАСТРОЙКИ' ? settings : null);
  const cfg = ctx.equipDiscCfg_();
  return (kit, inst, others) => ctx.equipDiscCalc_(cfg, kit.map(k => k.toLowerCase()), LOW, inst, others);
}

function client(rows) {                        // discCalc из Kit.html с конфигурацией от сервера
  const s = fs.readFileSync(path.join(ROOT, 'Kit.html'), 'utf8');
  const a = s.indexOf('function lowParts('), b = s.indexOf('function selKits(){');
  const ctx = { PR: PRICES };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(s.slice(a, b), ctx);
  const srv = server(rows);
  return (kit, inst, others) => {
    const cfgCtx = {}; // конфигурация — та же, что отдаёт appEquipOrders
    return { srv: srv(kit, inst, others), cli: (ctx.DC = clientCfg(rows), ctx.discCalc(kit, inst, others)) };
  };
}
function clientCfg(rows) {
  const ctx = {
    console, CONFIG: { DRY_RUN: false },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  for (const f of ['Settings.js', 'EquipLinks.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const data = [['Ключ', 'Объект', 'Значение', 'Изменено']].concat(rows || []);
  ctx.dbRead_ = () => ({ getLastRow: () => data.length, getRange: (r, c, n = 1, m = 1) => ({ getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => (data[r - 1 + i] || [])[c - 1 + j] ?? '')), getDisplayValues() { return this.getValues().map(x => x.map(String)); } }) });
  return JSON.parse(JSON.stringify(ctx.equipDiscCfg_()));
}

test('по умолчанию: весь комплект в одном заказе — 620 → 525 (как у Stashkevich, Eliseev)', () => {
  const r = server()(FULL, false, []);
  assert.deepEqual([r.total, r.disc], [620, 525]);
});

test('без дождевика или без тренировочной скидки нет (Kotov 470, Filatov 520, Valuzhnevich 250)', () => {
  const calc = server();
  assert.equal(calc(['Тренировочная форма', 'Спортивный костюм', 'Игровая форма'], false, []).disc, null);
  assert.equal(calc(['Дождевик', 'Спортивный костюм', 'Игровая форма'], false, []).disc, null);
  assert.equal(calc(['Дождевик', 'Тренировочная форма'], false, []).disc, null);
});

test('базовый набор в прошлом заказе: доплата = (прежнее + новое) со скидкой − прежнее', () => {
  const r = server()(['Спортивный костюм', 'Дождевик'], false, [{ kit: 'Игровая форма + Тренировочная форма', sum: 300 }]);
  // (300 + 320) * 0.85 = 527 → 525; доплата 525 − 300 = 225
  assert.equal(r.disc, 225);
});

test('вратарская вместо игровой подходит; носки и гетры — по полной цене', () => {
  const r = server()(['Спортивный костюм', 'Дождевик', 'Носки', 'Гетры'], false, [{ kit: 'Вратарская форма + Тренировочная форма', sum: 300 }]);
  // (300 + 320) * 0.85 → 525 − 300 = 225, плюс носки 15 и гетры 20
  assert.equal(r.disc, 260);
});

test('рассрочка — без скидки', () => {
  assert.equal(server()(FULL, true, []).disc, null);
});

test('настройки меняют правило: 10 %, округление 10, условие — только дождевик, 0 % выключает', () => {
  const calc = server([['equip.discPct', '', '10'], ['equip.discRound', '', '10'], ['equip.discNeedAll', '', 'Дождевик'], ['equip.discNeedOwn', '', 'Тренировочная форма, Игровая форма или Вратарская форма']]);
  // 620 * 0.9 = 558 → 560
  assert.equal(calc(FULL, false, []).disc, 560);
  assert.equal(calc(['Дождевик', 'Тренировочная форма', 'Игровая форма'], false, []).disc, 410); // 450*0.9=405 → 410 (округление половины вверх)
  assert.equal(server([['equip.discPct', '', '0']])(FULL, false, []).disc, null);
});

test('браузер считает так же, как сервер', () => {
  for (const rows of [[], [['equip.discPct', '', '10'], ['equip.discRound', '', '10']]]) {
    const both = client(rows);
    for (const [kit, inst, others] of [
      [FULL, false, []], [FULL, true, []],
      [['Спортивный костюм', 'Дождевик', 'Носки'], false, [{ kit: 'Игровая форма + Тренировочная форма', sum: 300 }]],
      [['Дождевик', 'Тренировочная форма'], false, []],
    ]) {
      const r = both(kit, inst, others);
      assert.equal(r.cli.disc, r.srv.disc, JSON.stringify(kit));
      assert.equal(r.cli.total, r.srv.total);
    }
  }
});

test('«или» понимается и в списке «в этом заказе»; боевые значения 20.10 — скидка только при всех четырёх позициях в заказе', () => {
  const rows = [['equip.discNeedAll', '', 'Игровая форма или Вратарская форма, Тренировочная форма, Спортивный костюм, Дождевик'],
    ['equip.discNeedOwn', '', 'Тренировочная форма, Игровая форма или Вратарская форма, Спортивный костюм, Дождевик']];
  const calc = server(rows);
  assert.equal(calc(FULL, false, []).disc, 525);
  assert.equal(calc(['Дождевик', 'Тренировочная форма', 'Спортивный костюм', 'Вратарская форма'], false, []).disc, 525);
  // Belich: в прошлом заказе игровая + тренировочная, сейчас костюм + дождевик — по этим значениям скидки нет
  assert.equal(calc(['Дождевик', 'Спортивный костюм'], false, [{ kit: 'Игровая форма + Тренировочная форма', sum: 300 }]).disc, null);
  // по умолчанию — есть: (300 + 320) * 0.85 → 525, доплата 225
  assert.equal(server()(['Дождевик', 'Спортивный костюм'], false, [{ kit: 'Игровая форма + Тренировочная форма', sum: 300 }]).disc, 225);
  const both = client(rows), r = both(['Дождевик', 'Тренировочная форма', 'Спортивный костюм', 'Вратарская форма'], false, []);
  assert.equal(r.cli.disc, r.srv.disc);
});

test('правило заказчика: весь комплект может собраться из нескольких заказов', () => {
  const calc = server();
  // сначала игровая + тренировочная (без скидки), потом костюм + дождевик: доплата со скидкой на весь комплект
  assert.equal(calc(['Игровая форма', 'Тренировочная форма'], false, []).disc, null);
  assert.equal(calc(['Спортивный костюм', 'Дождевик'], false, [{ kit: 'Игровая форма + Тренировочная форма', sum: 300 }]).disc, 225);
  // три заказа: игровая, потом костюм, потом тренировочная + дождевик — скидка на третьем
  const prior = [{ kit: 'Игровая форма', sum: 200 }, { kit: 'Спортивный костюм', sum: 170 }];
  assert.equal(calc(['Тренировочная форма', 'Дождевик'], false, prior).disc, 155);   // (370 + 250) * 0.85 → 525 − 370
  // комплекта нет (нет дождевика) — скидки нет; только носки — скидки нет
  assert.equal(calc(['Спортивный костюм'], false, [{ kit: 'Игровая форма + Тренировочная форма', sum: 300 }]).disc, null);
  assert.equal(calc(['Носки'], false, [{ kit: 'Дождевик + Тренировочная форма + Спортивный костюм + Игровая форма', sum: 525 }]).disc, null);
});
