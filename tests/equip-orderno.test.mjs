// Журнал «ОПЛАТЫ» ссылается на № заказа (столбец A листа экипировки), а не на строку.
// Регрессия: удаление заказа (строка удаляется целиком) не должно ломать отмену платежа и перепривязку
// заказов ниже удалённой строки. Настоящие EquipLinks.js, EquipLocation.js, Cancel.js, PaymentsV3.js
// и isRecentDup_ из Camps.js; таблицы — имитация в памяти.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

class Sheet {
  constructor(rows) { this.data = rows.map(r => r.slice()); }
  getLastRow() { return this.data.length; }
  getLastColumn() { return Math.max(...this.data.map(r => r.length)); }
  getRange(r, c, n = 1, m = 1) {
    const sh = this;
    const cell = (a, b) => { const x = sh.data[a - 1]; return x && x[b - 1] !== undefined ? x[b - 1] : ''; };
    const grid = f => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(r + i, c + j)));
    const rg = {
      getValue: () => cell(r, c),
      getValues: () => grid(cell),
      getDisplayValues: () => grid((a, b) => String(cell(a, b))),
      setValues: v => { v.forEach((row, i) => row.forEach((x, j) => {
        while (sh.data.length < r + i) sh.data.push([]);
        const rr = sh.data[r + i - 1]; while (rr.length < c + j) rr.push(''); rr[c + j - 1] = x;
      })); return rg; },
      setValue: x => rg.setValues([[x]]),
      setNumberFormat: () => rg,
    };
    return rg;
  }
  deleteRow(i) { this.data.splice(i - 1, 1); }
}

const HEAD = ['Дата записи', 'Дата', 'ID', 'ФИ', 'Что', 'Строка заказа', 'Сумма', 'Комментарий', 'Способ'];

// Заказ: [№, дата, ФИ, комплект, размер, надпись, номер, рассрочка, сумма, оплачено, долг, ID]
const order = (no, name, id, sum, paid) => [no, '', name, 'игровая', '140', '', '', '', sum, paid, '', id];

function env(orders, pays) {
  const eq = new Sheet([['ЭКИПИРОВКА'], [''], ['№']].concat(orders));
  const ps = new Sheet([HEAD].concat(pays.map(p => [new Date(0), '2026-10-01', p.id, p.name, 'Экипировка: игровая', p.no, p.sum, '', 'Наличные'])));
  const log = [];
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, CONFIG: { DRY_RUN: false },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActive: () => ({}) },
  };
  vm.createContext(ctx);
  for (const f of ['Equip.js', 'EquipLinks.js', 'EquipLocation.js', 'Cancel.js', 'PaymentsV3.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  const camps = fs.readFileSync(path.join(ROOT, 'Camps.js'), 'utf8');            // isRecentDup_ — настоящая функция
  const s = camps.indexOf('function isRecentDup_');
  vm.runInContext(camps.slice(s, camps.indexOf('\n}\n', s) + 2), ctx);
  Object.assign(ctx, {
    PAY_SHEET: 'ОПЛАТЫ', PAY_HEAD: HEAD, PAY_METHODS: ['Наличные', 'Перевод'],
    equipSheet_: () => eq,
    dbRead_: n => (n === 'ОПЛАТЫ' ? ps : null), dbSheet_: n => (n === 'ОПЛАТЫ' ? ps : null),
    readRegistry_: () => ({ players: [{ id: 'KS-9', name: 'Nine Player', loc: '' }] }),
    equipSyncLocations_: () => 0,
    checkAdmin_: p => { if (String(p) !== '9') throw new Error('Неверный код администратора'); },
    cacheDropBig_() {}, logChange_: (...a) => log.push(a), today_: () => '2026-10-16', fmt_() {},
  });
  const rowOf = no => eq.data.findIndex((r, i) => i >= 3 && Number(r[0]) === no) + 1;   // строка заказа №no
  const paidOf = no => eq.data[rowOf(no) - 1][9];
  return { ctx, eq, ps, log, rowOf, paidOf };
}

// №1 A, №2 B (без оплаты), №3 C (оплачено 100), №4 D, №5 C — второй заказ того же игрока (оплачено 200)
function base() {
  return env([
    order(1, 'Alpha A', 'KS-1', 300, 0),
    order(2, 'Beta B', 'KS-2', 300, 0),
    order(3, 'Gamma C', 'KS-3', 300, 100),
    order(4, 'Delta D', 'KS-4', 300, 0),
    order(5, 'Gamma C', 'KS-3', 200, 200),
  ], [
    { id: 'KS-3', name: 'Gamma C', no: 3, sum: 100 },
    { id: 'KS-3', name: 'Gamma C', no: 5, sum: 200 },
  ]);
}

test('удаление заказа без оплаты: строка удаляется, нижние заказы сдвигаются, журнал не меняется', () => {
  const e = base();
  const before = e.ps.data.map(r => r.slice());
  assert.equal(e.rowOf(3), 6);
  e.ctx.appDeleteOrder('9', 5);                                   // №2
  assert.equal(e.rowOf(2), 0);
  assert.equal(e.rowOf(3), 5);                                    // №3 поднялся на строку
  assert.equal(e.ctx.eqRowOfNo_(e.eq, 3), 5);
  assert.equal(e.ctx.eqRowOfNo_(e.eq, 5), 7);
  assert.deepEqual(e.ps.data, before);                            // «Строка заказа» в журнале прежняя (№ заказа)
  assert.deepEqual([e.paidOf(1), e.paidOf(3), e.paidOf(4), e.paidOf(5)], [0, 100, 0, 200]);
});

test('заказ с оплатой не удаляется', () => {
  const e = base();
  assert.throws(() => e.ctx.appDeleteOrder('9', 6), /есть оплата/);
  assert.equal(e.rowOf(3), 6);
});

test('отмена платежа по заказу ниже удалённой строки уменьшает «оплачено» именно у этого заказа', () => {
  const e = base();
  e.ctx.appDeleteOrder('9', 5);                                   // №2, выше обоих заказов C
  e.ctx.appCancelPayment('9', 'eq', 2);                          // платёж по №3
  assert.deepEqual([e.paidOf(3), e.paidOf(5), e.paidOf(1), e.paidOf(4)], [0, 200, 0, 0]);
  const rev = e.ps.data[e.ps.data.length - 1];
  assert.deepEqual([rev[2], rev[5], rev[6], rev[7]], ['KS-3', 3, -100, 'отмена платежа, строка 2']);
  e.ctx.appCancelPayment('9', 'eq', 3);                          // платёж по №5 (второй заказ того же игрока)
  assert.deepEqual([e.paidOf(3), e.paidOf(5)], [0, 0]);
  assert.throws(() => e.ctx.appCancelPayment('9', 'eq', 3), /уже отменён/);
});

test('отмена платежа по удалённому заказу: «не найден», ничего не меняется', () => {
  const e = env([order(1, 'Alpha A', 'KS-1', 300, 0), order(2, 'Beta B', 'KS-2', 300, 0)],
    [{ id: 'KS-1', name: 'Alpha A', no: 1, sum: 50 }]);
  e.ctx.appDeleteOrder('9', 4);                                   // №1 (оплачено 0: платёж уже был отменён вручную)
  const before = JSON.stringify([e.eq.data, e.ps.data]);
  assert.throws(() => e.ctx.appCancelPayment('9', 'eq', 2), /не найден/);
  assert.equal(JSON.stringify([e.eq.data, e.ps.data]), before);
});

test('перепривязка после удаления соседней строки переносит платежи только этого заказа', () => {
  const e = base();
  e.ctx.appDeleteOrder('9', 5);                                   // №2
  const r = e.ctx.appRelink('9', e.rowOf(3), 'KS-9', false);      // №3 → KS-9
  assert.equal(r.moved, 1);
  assert.deepEqual(e.ps.data.slice(1).map(x => [x[2], x[5]]), [['KS-9', 3], ['KS-3', 5]]);
  assert.equal(e.eq.data[e.rowOf(3) - 1][11], 'KS-9');
  assert.equal(e.eq.data[e.rowOf(5) - 1][11], 'KS-3');
});

test('оплата после удаления соседней строки пишет в журнал № заказа, а не строку', () => {
  const e = base();
  e.ctx.appDeleteOrder('9', 5);                                   // №2; №4 теперь в строке 6
  e.ctx.appAddPayment('9', 'KS-4', 6, 120, '2026-10-16', '', 'Перевод');
  const last = e.ps.data[e.ps.data.length - 1];
  assert.deepEqual([last[2], last[5], last[6]], ['KS-4', 4, 120]);
  assert.equal(e.paidOf(4), 120);
});

test('повторное нажатие «Оплатить» в течение 15 секунд не записывает второй платёж', () => {
  const e = base();
  e.ctx.appAddPayment('9', 'KS-4', 7, 120, '2026-10-16', '', 'Перевод');
  assert.throws(() => e.ctx.appAddPayment('9', 'KS-4', 7, 120, '2026-10-16', '', 'Перевод'), /повтор/);
  assert.equal(e.paidOf(4), 120);
});
