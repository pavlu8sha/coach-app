// Даты сборов: читаются в часовом поясе файла AdminApp, а не таблицы посещаемости (иначе сдвиг на день).
// Реальные Players.js (isoOf_) и Camps.js (campAll_); таблицы — имитация.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function formatDate(d, tz, f) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz === 'GMT' ? 'UTC' : tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]));
  assert.equal(f, 'yyyy-MM-dd');
  return `${p.year}-${p.month}-${p.day}`;
}
// Полночь указанного дня по времени Тбилиси (UTC+4) — так отдаёт Date ячейка с датой в файле с поясом Тбилиси
const tbilisiMidnight = (D, y, m, d) => new D(Date.UTC(y, m - 1, d) - 4 * 3600 * 1000);   // D — Date из контекста скрипта

function env(adminTz, attTz) {
  const ctx = { console, CONFIG: { DRY_RUN: false }, Utilities: { formatDate },
    CacheService: { getScriptCache: () => ({ get: () => null, getAll: () => ({}), putAll() {}, removeAll() {} }) } };
  vm.createContext(ctx);
  const D = vm.runInContext('Date', ctx);
  const rows = [['ID', 'Название', 'Место', 'Начало', 'Конец', 'Бронь', 'Срок брони', 'Срок оплаты', 'Активен'],
    ['CMP-0001', 'Ureki', 'K', tbilisiMidnight(D, 2027, 1, 3), tbilisiMidnight(D, 2027, 1, 10), 500, tbilisiMidnight(D, 2026, 12, 1), tbilisiMidnight(D, 2026, 12, 20), 'да']];
  const sheet = {
    getLastRow: () => rows.length,
    getRange: (r, c, n = 1, m = 1) => ({ getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => rows[r + i - 1]?.[c + j - 1] ?? '')) }),
  };
  const empty = { getLastRow: () => 1 };
  for (const f of ['Players.js', 'Camps.js']) vm.runInContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  Object.assign(ctx, {
    perfCache_() {},
    attSS_: () => ({ getSpreadsheetTimeZone: () => attTz }),
    campSS_: () => ({ getSpreadsheetTimeZone: () => adminTz }),
    campSheets_: () => ({ cs: sheet, ts: empty, ps: empty, ys: empty }),
  });
  return ctx;
}

test('даты сбора не сдвигаются, когда пояс AdminApp отличается от пояса таблицы посещаемости', () => {
  const c = env('Asia/Tbilisi', 'UTC').campAll_().camps[0];
  assert.deepEqual([c.start, c.end, c.depositBy, c.payBy], ['2027-01-03', '2027-01-10', '2026-12-01', '2026-12-20']);
});

test('даты сбора те же, когда пояса совпадают', () => {
  const c = env('Asia/Tbilisi', 'Asia/Tbilisi').campAll_().camps[0];
  assert.deepEqual([c.start, c.end, c.depositBy, c.payBy], ['2027-01-03', '2027-01-10', '2026-12-01', '2026-12-20']);
});
