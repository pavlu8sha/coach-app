// Лента «Оплаты за сегодня»: результат прежний, а дата форматируется один раз на день, а не на каждую строку.
// Настоящие SubsPay.js и PaymentsV3.js; листы журналов — имитация.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function sheet(rows) { return { getLastRow: () => rows.length + 1, getRange: (r, c, n, m) => ({ getValues: () => rows.slice(r - 2, r - 2 + n).map(x => x.slice(0, m)) }) }; }

function run(extraRows = 0) {
  let fmt = 0;
  const ctx = { console: { log() {} }, CONFIG: { DRY_RUN: false },
    Utilities: { formatDate: (d) => { fmt++; return d.toISOString().slice(0, 10); } } };
  vm.createContext(ctx);
  const T = vm.runInContext('new Date()', ctx), TD = T.toISOString().slice(0, 10), DM = TD.slice(8, 10) + '.' + TD.slice(5, 7);
  const D = vm.runInContext('(s) => new Date(s + "T00:00:00Z")', ctx);
  const old = Array.from({ length: extraRows }, (_, i) => [T, D('2026-09-0' + (1 + (i % 3))), 'KS-9', 'Old', '09.26', 'U9-A', 165, 'Оплата', '', 'Наличные']);
  const sheets = {
    'АБОНЕМЕНТЫ': sheet(old.concat([[T, D(TD), 'KS-1', 'Ana', '10.26', 'U9-A', 165, 'Оплата', '', 'Наличные'], [T, '2000-01-01', 'KS-2', 'Bob', '10.26', 'U9-A', 165, 'Оплата', '', 'Перевод']])),
    'ОПЛАТЫ': sheet([[T, D(TD), 'KS-3', 'Cid', 'Экипировка: Носки', 12, 15, '', 'Перевод'], [T, TD, 'KS-3', 'Cid', 'Экипировка: Носки', 12, -15, 'отмена платежа, строка 2', 'Перевод']]),
    'ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ': sheet([[T, 'Инд|2026-10-25 19:00', 'Dan', 50, 'Наличные', 'Оплата', '']]),
    'ДОПОЛНИТЕЛЬНЫЕ ОПЛАТЫ': sheet([[T, DM + '|x', 'Eve', 30, 'Перевод', 'Оплата', '']]),
  };
  for (const f of ['SubsPay.js', 'PaymentsV3.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  Object.assign(ctx, {
    SUB_SHEET: 'АБОНЕМЕНТЫ', PAY_SHEET: 'ОПЛАТЫ', IND_LOG: 'ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ', EXTRA_LOG: 'ДОПОЛНИТЕЛЬНЫЕ ОПЛАТЫ',
    checkAdmin_() {}, adminSS_: () => ({ getSpreadsheetTimeZone: () => 'UTC' }), dbRead_: n => sheets[n] || null,
    indDayStr_: () => '',
  });
  const r = JSON.parse(JSON.stringify(ctx.appTodayPayments('9')));
  return { r, fmt };
}

test('лента за сегодня: абонемент, экипировка, отмена, индивидуальное, дополнительное — как раньше', () => {
  const { r } = run();
  assert.deepEqual(r.totals, { 'Наличные': 215, 'Перевод': 30, other: 0 });
  assert.deepEqual(r.items.map(x => [x.src, x.amount, x.reversed, x.canCancel]).sort(),
    [['eq', -15, false, false], ['eq', 15, true, false], ['ext', 30, false, false], ['ind', 50, false, false], ['sub', 165, false, true]].sort());
});

test('300 старых строк за 3 дня: результат тот же, formatDate по журналам — не на каждую строку', () => {
  const a = run(), b = run(300);
  assert.deepEqual(b.r.totals, a.r.totals);
  assert.deepEqual(b.r.items.map(x => [x.src, x.amount]).sort(), a.r.items.map(x => [x.src, x.amount]).sort());
  assert.ok(b.fmt - a.fmt <= 3, 'лишних вызовов formatDate: ' + (b.fmt - a.fmt));   // +3 новых дня, а не +300 строк
});
