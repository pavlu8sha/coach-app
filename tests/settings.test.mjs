// Тесты настроек (Settings.js) на имитации AdminApp, кэша и свойств скрипта. Запуск: node --test tests/*.mjs
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
  cell(r, c) { const x = this.data[r - 1]; return x && x[c - 1] !== undefined ? x[c - 1] : ''; }
  getRange(r, c, n = 1, m = 1) {
    const sh = this;
    return {
      getDisplayValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => String(sh.cell(r + i, c + j)))),
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => {
        while (sh.data.length < r + i) sh.data.push([]);
        const rr = sh.data[r + i - 1]; while (rr.length < c + j) rr.push(''); rr[c + j - 1] = x;
      })),
      setNumberFormat() {},
    };
  }
}

function env(opts = {}) {
  const admin = { sheet: opts.rows ? new Sheet([['Ключ', 'Объект', 'Значение', 'Изменено']].concat(opts.rows)) : null };
  const props = Object.assign({ APP_ADMIN_PIN: '9', EQUIP_ID: 'eq' }, opts.props || {});
  const cache = {}, log = [];
  const ctx = {
    console: { warn() {}, error() {}, log() {} },
    CONFIG: { DRY_RUN: false },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => (opts.equipSheets || ['СЕЗОН 2026-2027']).includes(n) ? {} : null }) },
    dbRead_: n => (n === 'НАСТРОЙКИ' ? admin.sheet : null),
    dbSheet_: (n, head) => { if (!admin.sheet) admin.sheet = new Sheet([head]); return admin.sheet; },
    checkAdmin_: pin => { if (String(pin) !== props.APP_ADMIN_PIN) throw new Error('Неверный код администратора'); },
    prop_: k => props[k],
    cacheDropBig_() {},
    logChange_: (...a) => log.push(a),
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Settings.js'), 'utf8'), ctx, { filename: 'Settings.js' });
  // новый «запуск» скрипта: память запуска сбрасывается, кэш и свойства остаются
  const newRun = () => vm.runInContext('_settingsRun = null; _settingsWarned = {};', ctx);
  return { ctx, admin, props, cache, log, newRun };
}
const arr = v => (Array.isArray(v) ? [...v] : v);

test('лист настроек пуст или его нет: значения как раньше в коде', () => {
  for (const e of [env(), env({ rows: [] })]) {
    const g = e.ctx.settingGet_;
    assert.equal(g('stats.lowPct'), 50);
    assert.equal(g('matches.champFee', 'U10-A'), 200);
    assert.equal(g('matches.champFee', 'U13-A'), 300);
    assert.equal(g('matches.champFee'), 200);
    assert.equal(g('equip.seasonSheet'), 'СЕЗОН 2026-2027');
    assert.deepEqual(arr(g('funnel.activeSheets')), ['Осень 2026']);
  }
});

test('значения из листа: общее и по объекту; умолчание кода для объекта сильнее общего значения листа', () => {
  const e = env({ rows: [['stats.lowPct', '', '60'], ['matches.champFee', '', '220'], ['matches.champFee', 'U9', '150']] });
  const g = e.ctx.settingGet_;
  assert.equal(g('stats.lowPct'), 60);
  assert.equal(g('matches.champFee', 'U10-A'), 220);
  assert.equal(g('matches.champFee', 'U9'), 150);
  assert.equal(g('matches.champFee', 'U13-A'), 300);
});

test('неверное значение в листе: берётся значение по умолчанию, ошибка видна в appSettings', () => {
  const e = env({ rows: [['stats.lowPct', '', 'полтинник'], ['matches.champFee', '', '-5']] });
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 50);
  assert.equal(e.ctx.settingGet_('matches.champFee', 'U10-A'), 200);
  const items = e.ctx.appSettings('9').items;
  assert.match(items.find(x => x.key === 'stats.lowPct').error, /нужно число/);
  assert.match(items.find(x => x.key === 'matches.champFee' && !x.obj).error, /не меньше 0/);
});

test('из значения ничего не выполняется: код и формулы остаются текстом', () => {
  const e = env({ rows: [['funnel.activeSheets', '', 'Осень 2026, ");throw 1;(", =IMPORTRANGE("x")'], ['equip.seasonSheet', '', 'function(){return 1}']] });
  assert.deepEqual(arr(e.ctx.settingGet_('funnel.activeSheets')), ['Осень 2026', '");throw 1;("', '=IMPORTRANGE("x")']);
  assert.equal(e.ctx.settingGet_('equip.seasonSheet'), 'function(){return 1}');
});

test('воронка: старое свойство FUNNEL_ACTIVE работает, пока нет настройки; настройка из листа сильнее', () => {
  assert.deepEqual(arr(env({ props: { FUNNEL_ACTIVE: 'Весна 2027, Осень 2026' } }).ctx.settingGet_('funnel.activeSheets')), ['Весна 2027', 'Осень 2026']);
  const e = env({ props: { FUNNEL_ACTIVE: 'Весна 2027' }, rows: [['funnel.activeSheets', '', 'Зима 2027']] });
  assert.deepEqual(arr(e.ctx.settingGet_('funnel.activeSheets')), ['Зима 2027']);
});

test('сохранение: только админ, проверка значения на сервере', () => {
  const e = env();
  assert.throws(() => e.ctx.appSettingsSave('1', 'stats.lowPct', '', 60), /Неверный код администратора/);
  assert.throws(() => e.ctx.appSettingsSave('9', 'stats.lowPct', '', 150), /не больше 100/);
  assert.throws(() => e.ctx.appSettingsSave('9', 'stats.lowPct', '', '5.5'), /целое/);
  assert.throws(() => e.ctx.appSettingsSave('9', 'stats.lowPct', 'U9', 60), /нет значений по объектам/);
  assert.throws(() => e.ctx.appSettingsSave('9', 'equip.seasonSheet', '', 'СЕЗОН 2027-2028'), /нет листа/);
  assert.throws(() => e.ctx.appSettingsSave('9', 'nope', '', 1), /Неизвестная настройка/);
  assert.equal(e.admin.sheet, null); // ничего не записано
});

test('сохранение: строка в листе, журнал изменений, кэш сразу не мешает (и в следующем запуске тоже)', () => {
  const e = env({ equipSheets: ['СЕЗОН 2026-2027', 'СЕЗОН 2027-2028'] });
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 50);       // значение закэшировано
  const r = e.ctx.appSettingsSave('9', 'stats.lowPct', '', '60');
  assert.equal(r.value, 60);
  e.newRun();
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 60);
  e.ctx.appSettingsSave('9', 'matches.champFee', 'U13-A', 350);
  e.ctx.appSettingsSave('9', 'equip.seasonSheet', '', 'СЕЗОН 2027-2028');
  e.ctx.appSettingsSave('9', 'stats.lowPct', '', '65');        // повтор: та же строка
  e.newRun();
  assert.equal(e.ctx.settingGet_('matches.champFee', 'U13-A'), 350);
  assert.equal(e.ctx.settingGet_('equip.seasonSheet'), 'СЕЗОН 2027-2028');
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 65);
  assert.deepEqual(e.admin.sheet.data.slice(1).map(x => x.slice(0, 3)),
    [['stats.lowPct', '', '65'], ['matches.champFee', 'U13-A', '350'], ['equip.seasonSheet', '', 'СЕЗОН 2027-2028']]);
  assert.deepEqual(e.log.map(a => [a[2], a[3], a[4]]), [
    ['настройка: Порог низкой посещаемости, %', '50', '60'],
    ['настройка: Взнос за чемпионат по умолчанию, ₾ (U13-A)', '300', '350'],
    ['настройка: Лист заказов текущего сезона', 'СЕЗОН 2026-2027', 'СЕЗОН 2027-2028'],
    ['настройка: Порог низкой посещаемости, %', '60', '65'],
  ]);
});

test('пустое значение возвращает умолчание', () => {
  const e = env({ rows: [['stats.lowPct', '', '70']] });
  e.ctx.appSettingsSave('9', 'stats.lowPct', '', '');
  e.newRun();
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 50);
});

test('ручная правка листа видна после «Обновить данные» (settingsBump_)', () => {
  const e = env({ rows: [['stats.lowPct', '', '70']] });
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 70);
  e.admin.sheet.data[1][2] = '40';
  e.newRun();
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 70);         // кэш ещё жив
  e.ctx.settingsBump_();
  assert.equal(e.ctx.settingGet_('stats.lowPct'), 40);
});

test('подсказка взноса для формы матчей', () => {
  const e = env({ rows: [['matches.champFee', '', '220'], ['matches.champFee', 'U9', '150']] });
  const d = e.ctx.champFeeDefaults_();
  assert.equal(d.def, 220);
  assert.deepEqual({ ...d.byTeam }, { 'U13-A': 300, 'U9': 150 });
});
