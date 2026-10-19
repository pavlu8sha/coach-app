// Цены с месяца начала действия: настоящие Settings.js и Prices.js, лист «ЦЕНЫ» — имитация.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mm = off => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + off); return String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getFullYear()).slice(2); };

class Sheet {
  constructor(rows) { this.data = rows.map(r => r.slice()); }
  getLastRow() { return this.data.length; }
  getRange(r, c, n = 1, m = 1) {
    const sh = this;
    const cell = (a, b) => { const x = sh.data[a - 1]; return x && x[b - 1] !== undefined ? x[b - 1] : ''; };
    const grid = f => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(r + i, c + j)));
    const rg = {
      getValues: () => grid(cell), getDisplayValues: () => grid((a, b) => String(cell(a, b))),
      setValues: v => { v.forEach((row, i) => row.forEach((x, j) => { while (sh.data.length < r + i) sh.data.push([]); const rr = sh.data[r + i - 1]; while (rr.length < c + j) rr.push(''); rr[c + j - 1] = x; })); return rg; },
      setNumberFormat: () => rg,
    };
    return rg;
  }
  deleteRow(i) { this.data.splice(i - 1, 1); }
}

function env(rows) {
  const sheets = {}, props = { SET_VER: '0' }, cache = {}, log = [];
  if (rows) sheets['ЦЕНЫ'] = new Sheet([['С месяца', 'Позиция', 'Группа', 'Цена, ₾', 'Изменено']].concat(rows));
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, CONFIG: { DRY_RUN: false },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: () => '19.10.2026' }, Session: { getScriptTimeZone: () => 'Asia/Tbilisi' },
  };
  vm.createContext(ctx);
  for (const f of ['Settings.js', 'Prices.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const sp = fs.readFileSync(path.join(ROOT, 'SubsPay.js'), 'utf8');
  vm.runInContext(sp.slice(sp.indexOf('function nfSafe_'), sp.indexOf('\n', sp.indexOf('function nfSafe_'))), ctx);
  Object.assign(ctx, {
    dbRead_: n => sheets[n] || null, dbSheet_: (n, h) => sheets[n] || (sheets[n] = new Sheet([h])),
    checkAdmin_: p => { if (String(p) !== '9') throw new Error('Неверный код администратора'); },
    norm: s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    logChange_: (...a) => log.push(a),
  });
  return { ctx, sheets, log };
}

test('без листа — прежние цены: абонемент 165, weekends 130, индивидуальное 50', () => {
  const { ctx } = env();
  assert.equal(ctx.tariff_('U9-A', '10.26'), 165);
  assert.equal(ctx.tariff_('Weekends', '10.26'), 130);
  assert.equal(ctx.indPrice_('2026-10-25'), 50);
});

test('новая цена с месяца: прошлые месяцы по старой, своя цена группы важнее общей', () => {
  const { ctx } = env([['11.26', 'Абонемент', '', '180'], ['01.27', 'Абонемент', 'U13-A', '200'], ['12.26', 'Индивидуальное занятие', '', '60']]);
  assert.equal(ctx.tariff_('U9-A', '10.26'), 165);       // до 11.26 — по умолчанию
  assert.equal(ctx.tariff_('U9-A', '11.26'), 180);
  assert.equal(ctx.tariff_('U13-A', '12.26'), 180);
  assert.equal(ctx.tariff_('U13-A', '01.27'), 200);
  assert.equal(ctx.tariff_('weekends', '01.27'), 130);    // своя цена weekends по умолчанию сохраняется
  assert.equal(ctx.indPrice_('2026-11-30'), 50);
  assert.equal(ctx.indPrice_('2026-12-01'), 60);
  assert.equal(ctx.indPrice_('05.12.2026'), 60);          // дата дд.мм.гггг
});

test('добавление: только с текущего или будущего месяца, без повторов; запись в журнал', () => {
  const { ctx, sheets, log } = env();
  assert.throws(() => ctx.appPriceAdd('9', { from: mm(-1), kind: 'Абонемент', group: '', price: 170 }), /прошлые месяцы/);
  ctx.appPriceAdd('9', { from: mm(1), kind: 'Абонемент', group: '', price: '170' });
  assert.deepEqual(sheets['ЦЕНЫ'].data[1].slice(0, 4), [mm(1), 'Абонемент', '', 170]);
  assert.equal(ctx.tariff_('U9-A', mm(1)), 170);
  assert.equal(ctx.tariff_('U9-A', mm(0)), 165);
  assert.throws(() => ctx.appPriceAdd('9', { from: mm(1), kind: 'Абонемент', group: '', price: 175 }), /уже есть/);
  assert.equal(log[0][2], 'цена: Абонемент с ' + mm(1));
  assert.deepEqual([log[0][3], log[0][4]], ['165', '170']);
});

test('проверка значений и прав', () => {
  const { ctx } = env();
  const bad = (o, re) => assert.throws(() => ctx.appPriceAdd('9', Object.assign({ from: mm(1), kind: 'Абонемент', group: '', price: 170 }, o)), re);
  bad({ from: '13.26' }, /ММ\.ГГ/);
  bad({ from: '2026-11' }, /ММ\.ГГ/);
  bad({ kind: 'Сбор' }, /позиция/);
  bad({ kind: 'Индивидуальное занятие', group: 'U9' }, /группа не указывается/);
  bad({ price: '-5' }, /цена/);
  bad({ price: 'abc' }, /цена/);
  assert.throws(() => ctx.appPriceAdd('1', { from: mm(1), kind: 'Абонемент', group: '', price: 170 }), /администратора/);
});

test('удалить можно только будущую цену', () => {
  const { ctx, sheets } = env([[mm(0), 'Абонемент', '', '170'], [mm(2), 'Абонемент', '', '190']]);
  assert.throws(() => ctx.appPriceDelete('9', 2), /Действующую или прошлую/);
  ctx.appPriceDelete('9', 3);
  assert.equal(sheets['ЦЕНЫ'].data.length, 2);
  assert.equal(ctx.tariff_('U9', mm(2)), 170);
});

test('неверная строка листа пропускается и видна на экране', () => {
  const { ctx } = env([['11.26', 'Абонемент', '', 'сто'], ['11.26', 'Абонемент', 'weekends', '140']]);
  const d = ctx.appPrices('9');
  assert.equal(d.rows.length, 1);
  assert.equal(d.bad[0].line, 2);
  assert.equal(ctx.tariff_('weekends', '11.26'), 140);
});
