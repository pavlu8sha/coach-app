// appEquipOrders читает каталог один раз; результат тот же, что при прежних трёх чтениях. Перенос из perf-phase1 без замеров.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAT = [
  { name: 'Тренировочная форма', price: 100, sizes: '', inscr: false, num: true, active: true },
  { name: 'Игровая форма', price: 200, sizes: '128, 140', inscr: true, num: true, active: true },
  { name: 'Старая позиция', price: 50, sizes: 'S', inscr: false, num: false, active: false },
  { name: 'Дождевик', price: 150, sizes: '128,134 , 140', inscr: false, num: true, active: true },
];

function env() {
  const calls = [];
  const ctx = { console: { log() {} }, CONFIG: { DRY_RUN: false } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  for (const f of ['EquipView.js', 'EquipLinks.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  Object.assign(ctx, {
    checkAdmin_: p => { if (String(p) !== '9') throw new Error('Неверный код администратора'); },
    cacheGetBig_: () => ({ orders: [{ id: 'KS-1' }], unl: [], unlinked: 0 }), cachePutBig_() {},
    catalog_: only => { calls.push(only); return JSON.parse(JSON.stringify(only ? CAT.filter(x => x.active) : CAT)); },
    equipDiscCfg_: () => ({ pct: 15 }),
  });
  return { ctx, calls };
}

test('каталог читается один раз, цены / размеры / флаги — как при прежних трёх вызовах', () => {
  const { ctx, calls } = env();
  const d = JSON.parse(JSON.stringify(ctx.appEquipOrders('9')));
  assert.deepEqual(calls, [false]);
  // прежний способ: kitPrices_() и kitSizes_() сами вызывали catalog_(true), флаги — catalog_(false)
  const old = env();
  const prices = JSON.parse(JSON.stringify(old.ctx.kitPrices_())), sizes = JSON.parse(JSON.stringify(old.ctx.kitSizes_()));
  assert.deepEqual(d.prices, prices);
  assert.deepEqual(d.sizes, sizes);
  assert.deepEqual(d.prices, { 'Тренировочная форма': 100, 'Игровая форма': 200, 'Дождевик': 150 });
  assert.deepEqual(d.sizes['Дождевик'], ['128', '134', '140']);
  assert.deepEqual(d.flags['старая позиция'], { inscr: false, num: false });   // флаги — по всему каталогу, как раньше
  assert.deepEqual(d.orders, [{ id: 'KS-1' }]);
  assert.deepEqual(d.disc, { pct: 15 });
});

test('пустой каталог — запасные цены, как раньше; права — как раньше', () => {
  const { ctx } = env();
  ctx.catalog_ = () => [];
  const d = JSON.parse(JSON.stringify(ctx.appEquipOrders('9')));
  assert.deepEqual(d.prices, JSON.parse(JSON.stringify(ctx.KIT_PRICES)));
  assert.throws(() => ctx.appEquipOrders('1'), /администратора/);
});
