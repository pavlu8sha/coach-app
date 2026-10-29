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
const order = (no, name, id, sum, paid) => [no, '', name, 'игровая', '140', '', '', '', sum, paid, '', id, '', `ORD-${no}`, '1'];

function env(orders, pays) {
  const eq = new Sheet([['ЭКИПИРОВКА'], [''], ['№']].concat(orders));
  const ps = new Sheet([HEAD].concat(pays.map((p, i) => [new Date(Date.UTC(2026, 9, 1, 8, i)), '2026-10-01', p.id, p.name, 'Экипировка: игровая', p.no, p.sum, '', 'Наличные'])));
  const log = [];
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, Date, CONFIG: { DRY_RUN: false },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActive: () => ({}) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  for (const f of ['Equip.js', 'EquipLinks.js', 'EquipLocation.js', 'Cancel.js', 'PaymentsV3.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  const camps = fs.readFileSync(path.join(ROOT, 'Camps.js'), 'utf8');            // isRecentDup_ — настоящая функция
  const s = camps.indexOf('function isRecentDup_');
  const m = /\r?\n\}/.exec(camps.slice(s));
  vm.runInContext(camps.slice(s, s + m.index + m[0].length), ctx);
  const sp = fs.readFileSync(path.join(ROOT, 'SubsPay.js'), 'utf8');             // nfSafe_ — настоящая функция из SubsPay.js
  vm.runInContext(sp.slice(sp.indexOf('function nfSafe_'), sp.indexOf('\n', sp.indexOf('function nfSafe_'))), ctx);
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
  // снимок заказа, который UI получил при загрузке списка: №, ФИО, ID игрока и ID заказа строки row
  const snap = row => { const r = eq.data[row - 1]; return { no: r[0], name: r[2], id: r[11], ord: r[13] }; };
  const psnap = row => { const r = ps.data[row - 1]; return { t: r[0].getTime(), name: r[3], amount: r[6] }; };   // снимок платежа, как его видит лента
  // сортировка/перестановка: две физические строки меняются местами
  const swap = (a, b) => { const t = eq.data[a - 1]; eq.data[a - 1] = eq.data[b - 1]; eq.data[b - 1] = t; };
  return { ctx, eq, ps, log, rowOf, paidOf, snap, psnap, swap };
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
  e.ctx.appDeleteOrder('9', 5, e.snap(5));                                   // №2
  assert.equal(e.rowOf(2), 0);
  assert.equal(e.rowOf(3), 5);                                    // №3 поднялся на строку
  assert.equal(e.ctx.eqRowOfNo_(e.eq, 3), 5);
  assert.equal(e.ctx.eqRowOfNo_(e.eq, 5), 7);
  assert.deepEqual(e.ps.data, before);                            // «Строка заказа» в журнале прежняя (№ заказа)
  assert.deepEqual([e.paidOf(1), e.paidOf(3), e.paidOf(4), e.paidOf(5)], [0, 100, 0, 200]);
});

test('заказ с оплатой не удаляется', () => {
  const e = base();
  assert.throws(() => e.ctx.appDeleteOrder('9', 6, e.snap(6)), /есть оплата/);
  assert.equal(e.rowOf(3), 6);
});

test('отмена платежа по заказу ниже удалённой строки уменьшает «оплачено» именно у этого заказа', () => {
  const e = base();
  e.ctx.appDeleteOrder('9', 5, e.snap(5));                                   // №2, выше обоих заказов C
  e.ctx.appCancelPayment('9', 'eq', 2, e.psnap(2));                          // платёж по №3
  assert.deepEqual([e.paidOf(3), e.paidOf(5), e.paidOf(1), e.paidOf(4)], [0, 200, 0, 0]);
  const rev = e.ps.data[e.ps.data.length - 1];
  assert.deepEqual([rev[2], rev[5], rev[6], rev[7]], ['KS-3', 3, -100, 'отмена платежа, строка 2']);
  e.ctx.appCancelPayment('9', 'eq', 3, e.psnap(3));                          // платёж по №5 (второй заказ того же игрока)
  assert.deepEqual([e.paidOf(3), e.paidOf(5)], [0, 0]);
  assert.throws(() => e.ctx.appCancelPayment('9', 'eq', 3, e.psnap(3)), /уже отменён/);
});

test('отмена платежа по удалённому заказу: «не найден», ничего не меняется', () => {
  const e = env([order(1, 'Alpha A', 'KS-1', 300, 0), order(2, 'Beta B', 'KS-2', 300, 0)],
    [{ id: 'KS-1', name: 'Alpha A', no: 1, sum: 50 }]);
  e.ctx.appDeleteOrder('9', 4, e.snap(4));                                   // №1 (оплачено 0: платёж уже был отменён вручную)
  const before = JSON.stringify([e.eq.data, e.ps.data]);
  assert.throws(() => e.ctx.appCancelPayment('9', 'eq', 2, e.psnap(2)), /не найден/);
  assert.equal(JSON.stringify([e.eq.data, e.ps.data]), before);
});

test('перепривязка после удаления соседней строки переносит платежи только этого заказа', () => {
  const e = base();
  e.ctx.appDeleteOrder('9', 5, e.snap(5));                                   // №2
  const r = e.ctx.appRelink('9', e.rowOf(3), 'KS-9', false, e.snap(e.rowOf(3)));      // №3 → KS-9
  assert.equal(r.moved, 1);
  assert.deepEqual(e.ps.data.slice(1).map(x => [x[2], x[5]]), [['KS-9', 3], ['KS-3', 5]]);
  assert.equal(e.eq.data[e.rowOf(3) - 1][11], 'KS-9');
  assert.equal(e.eq.data[e.rowOf(5) - 1][11], 'KS-3');
});

test('оплата после удаления соседней строки пишет в журнал № заказа, а не строку', () => {
  const e = base();
  e.ctx.appDeleteOrder('9', 5, e.snap(5));                                   // №2; №4 теперь в строке 6
  e.ctx.appAddPayment('9', 'KS-4', 6, 120, '2026-10-16', '', 'Перевод', e.snap(6));
  const last = e.ps.data[e.ps.data.length - 1];
  assert.deepEqual([last[2], last[5], last[6]], ['KS-4', 4, 120]);
  assert.equal(e.paidOf(4), 120);
});

test('повторное нажатие «Оплатить» в течение 15 секунд не записывает второй платёж', () => {
  const e = base();
  e.ctx.appAddPayment('9', 'KS-4', 7, 120, '2026-10-16', '', 'Перевод', e.snap(7));
  assert.throws(() => e.ctx.appAddPayment('9', 'KS-4', 7, 120, '2026-10-16', '', 'Перевод', e.snap(7)), /повтор/);
  assert.equal(e.paidOf(4), 120);
});

test('редактирование отклоняется, если строка теперь принадлежит другому заказу', () => {
  const e = base();
  const row = e.rowOf(4);
  const before = e.eq.data.map(r => r.slice());
  assert.throws(() => e.ctx.appEditOrder('9', row, {
    kit: 'игровая', size: '150', inscr: '', num: '', inst: false,
    expected: { ord: 'ORD-3', no: 3, name: 'Gamma C', id: 'KS-3', kit: 'игровая', size: '140', inscr: '', num: '', inst: '', sum: 300 }
  }), /Заказ изменился или строка сместилась/);
  assert.deepEqual(e.eq.data, before);
});

test('редактирование старого заказа без ord тоже сверяет полный снимок заказа', () => {
  const e = base();
  const row = e.rowOf(4);
  const before = e.eq.data.map(r => r.slice());
  assert.throws(() => e.ctx.appEditOrder('9', row, {
    kit: 'игровая', size: '150', inscr: '', num: '', inst: false,
    expected: { ord: '', no: 3, name: 'Gamma C', id: 'KS-3', kit: 'игровая', size: '140', inscr: '', num: '', inst: '', sum: 300 }
  }), /Заказ изменился или строка сместилась/);
  assert.deepEqual(e.eq.data, before);
});

// --- Сортировка листа после открытия формы (инцидент #277): все операции по номеру строки отказывают без единого изменения ---
const frozen = e => JSON.stringify([e.eq.data, e.ps.data, e.log]);

test('сортировка после открытия формы: удаление заказа №2 отклоняется, строки не меняются', () => {
  const e = base();
  const stale = e.snap(5);                         // форма открыта для №2 (строка 5)
  e.swap(5, 7);                                    // лист отсортировали: в строке 5 теперь №4
  const before = frozen(e);
  assert.throws(() => e.ctx.appDeleteOrder('9', 5, stale), /Заказ изменился или строка сместилась/);
  assert.equal(frozen(e), before);
  assert.equal(e.eq.data.length, 3 + 5);           // ничего не удалено
});

test('сортировка после открытия формы: перепривязка отклоняется, платежи и ID не меняются', () => {
  const e = base();
  const stale = e.snap(6);                         // №3 игрока KS-3
  e.swap(6, 8);                                    // в строке 6 теперь второй заказ того же игрока (№5)
  const before = frozen(e);
  assert.throws(() => e.ctx.appRelink('9', 6, 'KS-9', false, stale), /Заказ изменился или строка сместилась/);
  assert.equal(frozen(e), before);
});

test('сортировка после открытия формы: оплата не попадёт в чужой заказ даже у того же игрока', () => {
  const e = base();
  const stale = e.snap(6);                         // №3 (оплачено 100 из 300)
  e.swap(6, 8);                                    // №5 того же игрока KS-3 оказался в строке 6
  const before = frozen(e);
  assert.throws(() => e.ctx.appAddPayment('9', 'KS-3', 6, 50, '2026-10-16', '', 'Перевод', stale), /Заказ изменился или строка сместилась/);
  assert.equal(frozen(e), before);
  assert.deepEqual([e.paidOf(3), e.paidOf(5)], [100, 200]);
});

test('операции без снимка заказа (устаревшая форма) отклоняются целиком', () => {
  const e = base();
  const before = frozen(e);
  assert.throws(() => e.ctx.appDeleteOrder('9', 5), /откройте форму заново/);
  assert.throws(() => e.ctx.appRelink('9', 5, 'KS-9', false), /откройте форму заново/);
  assert.throws(() => e.ctx.appAddPayment('9', 'KS-2', 5, 10, '2026-10-16', '', 'Перевод'), /откройте форму заново/);
  assert.equal(frozen(e), before);
});

test('штатная работа: снимок совпадает — оплата, перепривязка и удаление проходят', () => {
  const e = base();
  assert.equal(e.ctx.appAddPayment('9', 'KS-2', 5, 40, '2026-10-16', '', 'Наличные', e.snap(5)).paid, 40);
  assert.equal(e.ctx.appRelink('9', 5, 'KS-9', true, e.snap(5)).ok, true);
  assert.equal(e.eq.data[4][11], 'KS-9');
  assert.equal(e.ctx.appRelink('9', 7, '', false, e.snap(7)).ok, true);      // отвязать №4
});

test('сортировка после открытия формы: правка заказа отклоняется, а штатная правка проходит (в т.ч. старый заказ без ord)', () => {
  const e = base();
  const row = e.rowOf(4);
  const form = (no, ord) => ({ kit: 'игровая', size: '150', inscr: '', num: '', inst: false,
    expected: { ord, no, name: e.eq.data[row - 1][2], id: e.eq.data[row - 1][11], kit: 'игровая', size: '140', inscr: '', num: '', inst: '', sum: 300 } });
  // каталог и скидки для пересчёта суммы — простые заглушки (проверяется адресация строки, а не цены)
  Object.assign(e.ctx, { catalog_: () => [{ name: 'игровая', price: 300 }], equipDiscCfg_: () => ({}), equipDiscCalc_: () => ({ total: 300, disc: null }), equipOthers_: () => [] });
  const staleForm = form(4, 'ORD-4');
  const row1 = e.rowOf(1);
  e.swap(row, row1);                               // №4 и №1 поменялись строками
  const before = frozen(e);
  assert.throws(() => e.ctx.appEditOrder('9', row, staleForm), /Заказ изменился или строка сместилась/);
  assert.equal(frozen(e), before);
  e.swap(row, row1);                               // вернули порядок: форма снова актуальна
  e.ctx.appEditOrder('9', row, staleForm);
  assert.equal(String(e.eq.data[row - 1][4]), '150');
  // старый заказ без ord: полный снимок совпадает — правка проходит
  e.eq.data[row - 1][13] = '';
  const r = e.eq.data[row - 1];
  const fresh = { ord: '', no: r[0], name: r[2], id: r[11], kit: String(r[3]), size: String(r[4]), inscr: String(r[5]), num: String(r[6]), inst: String(r[7]), sum: Number(r[8]) };
  e.ctx.appEditOrder('9', row, { kit: 'игровая', size: '160', inscr: '', num: '', inst: false, expected: fresh });
  assert.equal(String(e.eq.data[row - 1][4]), '160');
});
