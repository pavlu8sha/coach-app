// Редакторы каталога экипировки и тарифов сбора пишут по номеру строки: после сортировки листа строка — другая позиция.
// Форма присылает прежнее название (was), сервер сверяет его до записи.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (ctx, f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

class Sheet {
  constructor(rows) { this.data = rows.map(r => r.slice()); this.ops = []; }
  getLastRow() { return this.data.length; }
  getRange(r, c, n = 1, m = 1) {
    const sh = this;
    return {
      getValue: () => (sh.data[r - 1] || [])[c - 1] ?? '',
      setValue: v => { sh.ops.push(`set ${r}:${c}`); sh.data[r - 1] = sh.data[r - 1] || []; sh.data[r - 1][c - 1] = v; },
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => { sh.ops.push(`set ${r + i}:${c + j}`); sh.data[r - 1 + i] = sh.data[r - 1 + i] || []; sh.data[r - 1 + i][c - 1 + j] = x; })),
    };
  }
}

function catalogEnv() {
  const sh = new Sheet([['Название', 'Цена'], ['Игровая форма', 200], ['Носки', 15], ['Гетры', 20]]);
  const ctx = { console, CONFIG: { DRY_RUN: false }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) } };
  vm.createContext(ctx);
  load(ctx, 'Catalog.js');
  const log = [];
  Object.assign(ctx, {
    checkAdmin_: () => {}, catSheet_: () => sh, cacheDropBig_() {}, logChange_: (...a) => log.push(a),
    catalogLive_: () => sh.data.slice(1).map((r, i) => ({ row: i + 2, name: String(r[0]) })),
  });
  return { ctx, sh, log };
}

test('каталог: штатная правка с прежним названием сохраняется, новая позиция добавляется', () => {
  const e = catalogEnv();
  e.ctx.appCatalogSave('9', { row: 3, was: 'Носки', name: 'Носки', price: 16 });
  assert.equal(e.sh.data[2][1], 16);
  e.ctx.appCatalogSave('9', { row: 0, name: 'Шапка', price: 30 });
  assert.equal(e.sh.data[4][0], 'Шапка');
});

test('каталог: лист отсортирован после открытия формы — отказ без записи', () => {
  const e = catalogEnv();
  e.sh.data = [e.sh.data[0], e.sh.data[3], e.sh.data[2], e.sh.data[1]];            // теперь в строке 3 «Носки», в строке 2 «Гетры»
  assert.throws(() => e.ctx.appCatalogSave('9', { row: 2, was: 'Игровая форма', name: 'Игровая форма', price: 250 }), /сместилась/);
  assert.throws(() => e.ctx.appCatalogSave('9', { row: 2, name: 'Игровая форма', price: 250 }), /сместилась/);   // без was тоже отказ
  assert.deepEqual([e.sh.ops, e.log, e.sh.data[1][1]], [[], [], 20]);
});

function tariffEnv(order) {
  const ts = new Sheet([['Сбор', 'Тариф', 'Цена', 'Активен', 'Метка'],
    ...order.map(([n, p]) => ['CMP-1', n, p, 'да', ''])]);
  const ctx = { console, CONFIG: { DRY_RUN: false } };
  vm.createContext(ctx);
  load(ctx, 'Camps.js');
  const tariffs = () => ts.data.slice(1).map((r, i) => ({ row: i + 2, camp: r[0], name: r[1], price: r[2] }));
  Object.assign(ctx, {
    checkAdmin_: () => {}, campLocked_: fn => fn(), campDrop_() {}, r2_: x => Math.round(x * 100) / 100,
    campAll_: () => ({ tariffs: tariffs(), parts: [] }), campFind_: () => ({ id: 'CMP-1' }), campSheets_: () => ({ ts }),
  });
  return { ctx, ts };
}

test('тарифы: штатное сохранение и отказ после сортировки листа тарифов', () => {
  const e = tariffEnv([['Футболист', 1500], ['Ребенок + родитель', 2500]]);
  e.ctx.appCampTariffSave('9', 'CMP-1', [{ row: 2, was: 'Футболист', name: 'Футболист', price: 1600, active: true }, { row: 3, was: 'Ребенок + родитель', name: 'Ребенок + родитель', price: 2500, active: true }]);
  assert.equal(e.ts.data[1][2], 1600);
  const f = tariffEnv([['Ребенок + родитель', 2500], ['Футболист', 1500]]);     // порядок строк изменился после открытия формы
  assert.throws(() => f.ctx.appCampTariffSave('9', 'CMP-1', [{ row: 2, was: 'Футболист', name: 'Футболист', price: 1600, active: true }]), /сместилась/);
  assert.deepEqual([f.ts.ops, f.ts.data[1][2], f.ts.data[2][2]], [[], 2500, 1500]);
});
