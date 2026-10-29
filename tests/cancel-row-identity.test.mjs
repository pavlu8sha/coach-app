// Отмена платежей адресуется номером строки журнала (Cancel.js, Camps.js): после сортировки журнала строка — чужой платёж.
// Проверяем настоящие Cancel.js и appCampCancel: при несовпадении снимка платежа отказ до любой записи.
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
  cell(a, b) { const x = this.data[a - 1]; return x && x[b - 1] !== undefined ? x[b - 1] : ''; }
  put(a, b, v) { while (this.data.length < a) this.data.push([]); const r = this.data[a - 1]; while (r.length < b) r.push(''); r[b - 1] = v; }
  getRange(r, c, n = 1, m = 1) {
    const sh = this, grid = f => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(r + i, c + j)));
    const rg = {
      getValue: () => sh.cell(r, c), getValues: () => grid((a, b) => sh.cell(a, b)),
      setValue: x => { sh.ops.push('set ' + r + ':' + c); sh.put(r, c, x); return rg; },
      setValues: v => { sh.ops.push('set ' + r + ':' + c); v.forEach((row, i) => row.forEach((x, j) => sh.put(r + i, c + j, x))); return rg; },
      setNumberFormat: () => rg,
    };
    return rg;
  }
}

const T1 = new Date('2026-10-20T10:00:00Z'), T2 = new Date('2026-10-21T11:00:00Z');
const snap = r => ({ t: r[0].getTime(), name: r[3], amount: r[6] });
const E = () => Array(15).fill('');

function env() {
  // журнал оплат экипировки: [время, дата, ID, ФИ, за что, № заказа, сумма, комментарий, способ]
  const journal = new Sheet([['h'],
    [T1, '2026-10-20', 'KS-1', 'Alpha A', 'Экипировка', 1, 100, '', 'Наличные'],
    [T2, '2026-10-21', 'KS-2', 'Beta B', 'Экипировка', 2, 150, '', 'Перевод']]);
  const season = new Sheet([[''], [''], [''],
    [1, '', 'Alpha A', 'Форма', '', '', '', '', 300, 100, 200, 'KS-1', '', 'ORD-1'],
    [2, '', 'Beta B', 'Дождевик', '', '', '', '', 150, 150, 0, 'KS-2', '', 'ORD-2']].concat(Array.from({ length: 5 }, E)));
  const log = [];
  const ctx = { console, Date, CONFIG: { DRY_RUN: false }, PAY_SHEET: 'ОПЛАТЫ', SUB_SHEET: 'ПЛАТЕЖИ', LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) } };
  vm.createContext(ctx);
  load(ctx, 'Cancel.js'); load(ctx, 'EquipLocation.js');
  Object.assign(ctx, {
    EQ_FIRST: 4, EQ_ROWS: 250, equipSheet_: () => season, dbRead_: n => (n === 'ОПЛАТЫ' ? journal : null),
    SpreadsheetApp: { getActive: () => ({}) }, checkAdmin_: p => { if (p !== '9') throw new Error('pin'); },
    logChange_: (...a) => log.push(a), cacheDropBig_() {}, nfSafe_() {}, today_: () => '2026-10-29',
  });
  return { ctx, journal, season, log };
}

test('отмена оплаты экипировки: штатное сохранение при неизменной строке', () => {
  const e = env();
  const r = e.ctx.appCancelPayment('9', 'eq', 2, snap(e.journal.data[1]));
  assert.equal(r.ok, true);
  assert.equal(e.season.cell(4, 10), 0);
  assert.equal(e.journal.data.length, 4);
  assert.equal(e.journal.data[3][6], -100);
});

test('отмена оплаты экипировки: журнал отсортирован после загрузки ленты — отказ без записи', () => {
  const e = env();
  const stale = snap(e.journal.data[1]);                       // лента показала платёж Alpha в строке 2
  e.journal.data = [e.journal.data[0], e.journal.data[2], e.journal.data[1]];   // сортировка журнала: теперь в строке 2 Beta
  assert.throws(() => e.ctx.appCancelPayment('9', 'eq', 2, stale), /сместилась/);
  assert.deepEqual([e.journal.ops, e.season.ops, e.log, e.journal.data.length], [[], [], [], 3]);
  assert.equal(e.season.cell(5, 10), 150);
});

test('отмена оплаты: без снимка или с чужой суммой — отказ без записи', () => {
  const e = env();
  assert.throws(() => e.ctx.appCancelPayment('9', 'eq', 2), /Обновите/);
  assert.throws(() => e.ctx.appCancelPayment('9', 'eq', 2, { ...snap(e.journal.data[1]), amount: 99 }), /сместилась/);
  assert.throws(() => e.ctx.appCancelPayment('9', 'sub', 2, undefined), /Обновите|не найден/);
  assert.deepEqual([e.journal.ops, e.season.ops, e.log], [[], [], []]);
});

function campEnv(pays) {
  const ys = new Sheet([['h']]);
  const ctx = { console, Date, CONFIG: { DRY_RUN: false } };
  vm.createContext(ctx);
  load(ctx, 'Camps.js');
  const log = [];
  Object.assign(ctx, {
    checkAdmin_: p => { if (p !== '9') throw new Error('pin'); },
    campLocked_: fn => fn(), campDrop_() {}, campAll_: () => ({ pays, parts: [{ id: 'P1', pid: 'KS-1' }] }),
    campSheets_: () => ({ ys }), nfSafe_() {}, today_: () => '2026-10-29', logChange_: (...a) => log.push(a),
  });
  return { ctx, ys, log };
}
const pay = (row, t, name, amount) => ({ row, t, name, amount, camp: 'C1', part: 'P1', type: 'Оплата', method: 'Наличные', comment: '' });

test('отмена платежа сбора: штатное сохранение и отказ при сортировке листа', () => {
  const pays = [pay(2, 1000, 'Alpha A', 50), pay(3, 2000, 'Beta B', 70)];
  const e = campEnv(pays);
  assert.equal(e.ctx.appCampCancel('9', 2, { t: 1000, part: 'P1', amount: 50 }).ok, true);
  assert.equal(e.ys.data.length, 2);
  const f = campEnv([pay(2, 2000, 'Beta B', 70), pay(3, 1000, 'Alpha A', 50)]);   // после сортировки строка 2 — другой платёж
  assert.throws(() => f.ctx.appCampCancel('9', 2, { t: 1000, part: 'P1', amount: 50 }), /сместилась/);
  assert.throws(() => f.ctx.appCampCancel('9', 2), /сместилась/);
  assert.deepEqual([f.ys.ops, f.log, f.ys.data.length], [[], [], 1]);
});
