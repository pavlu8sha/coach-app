// Расписание сезона: лист «РАСПИСАНИЕ» (AdminApp) или расписание по умолчанию. Настоящие Settings.js, Schedule.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Прежнее расписание групп дня в «Отметках» (WebApp.js до переноса в настройки)
const OLD_SCHEDULE = {
  'U7-A': [1, 3, 5], 'U7-B': [1, 3, 5], 'U9-A': [1, 3, 5], 'U9-B': [1, 3, 5], 'U11': [1, 3, 5],
  'U10-A': [2, 4, 0], 'U10-B': [2, 4, 0], 'U13-B': [2, 4, 6], 'U13-C': [2, 4, 6],
  'Ortachala U9': [2, 4, 6], 'Ortachala U12': [2, 4, 6], 'U13-A': [1, 2, 4], 'Isani': [1, 3, 5], 'weekends': [6, 0],
};

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
      clearContent: () => { for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const rr = sh.data[r - 1 + i]; if (rr) rr[c - 1 + j] = ''; } return rg; },
      setNumberFormat: () => rg,
    };
    return rg;
  }
}

function env(sheetRows) {
  const sheets = {}, props = { SET_VER: '0' }, cache = {}, log = [];
  if (sheetRows) sheets['РАСПИСАНИЕ'] = new Sheet([['День', 'Локация', 'Начало', 'Конец', 'Группа', 'Тип', 'Тренеры', 'Группы в отметках']].concat(sheetRows));
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, CONFIG: { DRY_RUN: false },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  for (const f of ['Settings.js', 'Schedule.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const sp = fs.readFileSync(path.join(ROOT, 'SubsPay.js'), 'utf8');
  vm.runInContext(sp.slice(sp.indexOf('function nfSafe_'), sp.indexOf('\n', sp.indexOf('function nfSafe_'))), ctx);
  Object.assign(ctx, {
    dbRead_: n => sheets[n] || null,
    dbSheet_: (n, h) => sheets[n] || (sheets[n] = new Sheet([h])),
    checkAdmin_: p => { if (String(p) !== '9') throw new Error('Неверный код администратора'); },
    norm: s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    logChange_: (...a) => log.push(a),
  });
  return { ctx, sheets, log, next: () => vm.runInContext('_schedRun = null; _settingsRun = null;', ctx) };
}

test('без листа группы дня в «Отметках» — как в прежнем расписании', () => {
  const e = env();
  for (const [g, days] of Object.entries(OLD_SCHEDULE)) for (let wd = 0; wd < 7; wd++) {
    assert.equal(e.ctx.schedHasGroup_(g, wd), days.includes(wd), g + ' ' + wd);
  }
  assert.equal(e.ctx.schedHasGroup_('Индивидуальные / Вратарские', 3), true);   // нет в расписании — любой день
});

test('без листа дневное расписание тренировок — как прежний GN_SEASON', () => {
  const e = env();
  const src = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'gn-season-2026.txt'), 'utf8');
  const old = vm.runInNewContext(src.replace(/^var GN_SEASON = /, '').replace(/\]\.map[\s\S]*$/, ']'));
  const now = e.ctx.schedSeason_().map(x => [x.wd, x.loc, x.start, x.end, x.group, x.type, [...x.trainers]]);
  assert.deepEqual(JSON.parse(JSON.stringify(now)), JSON.parse(JSON.stringify(old)));
});

test('сохранение: лист создаётся, данные читаются из листа, журнал «было → стало»', () => {
  const e = env();
  const r = e.ctx.appScheduleSave('9', [
    { day: 'сб', loc: 'Красный парк', start: '9:00', end: '10:30', group: 'Weekends', type: 'Групповая', trainers: 'Руслан,Цотне', att: 'weekends' },
    { day: 'пн', loc: 'Исани', start: '16:30', end: '17:30', group: 'Исани U7', type: 'Групповая', trainers: 'Гио', att: 'Isani' },
  ]);
  assert.equal(r.count, 2);
  assert.deepEqual(e.sheets['РАСПИСАНИЕ'].data.slice(1), [
    ['пн', 'Исани', '16:30', '17:30', 'Исани U7', 'Групповая', 'Гио', 'Isani'],
    ['сб', 'Красный парк', '09:00', '10:30', 'Weekends', 'Групповая', 'Руслан, Цотне', 'weekends'],
  ]);
  e.next();
  assert.equal(e.ctx.appSchedule('9').source, 'sheet');
  assert.equal(e.ctx.schedHasGroup_('weekends', 0), false);   // воскресенья больше нет
  assert.equal(e.ctx.schedHasGroup_('weekends', 6), true);
  assert.equal(e.ctx.schedHasGroup_('U7-A', 2), true);          // группы нет в расписании — любой день
  assert.match(e.log[0][3], /по умолчанию, 33 трен\./);
  assert.equal(e.log[0][4], '2 трен.');
});

test('проверка строк: неверный день, время, порядок времени, тип, пустая группа; не админ', () => {
  const e = env(), ok = { day: 'пн', loc: 'Парк', start: '16:00', end: '17:00', group: 'U9', type: 'Групповая', trainers: '', att: '' };
  const bad = (patch, re) => assert.throws(() => e.ctx.appScheduleSave('9', [ok, Object.assign({}, ok, patch)]), re);
  bad({ day: 'xx' }, /Строка 2: день недели/);
  bad({ start: '25:00' }, /ЧЧ:ММ/);
  bad({ start: '18:00' }, /раньше конца/);
  bad({ type: 'Другая' }, /тип/);
  bad({ group: ' ' }, /группа/);
  assert.throws(() => e.ctx.appScheduleSave('9', []), /пустое/);
  assert.throws(() => e.ctx.appScheduleSave('1', [ok]), /администратора/);
  assert.equal(e.sheets['РАСПИСАНИЕ'], undefined);              // при ошибке лист не создаётся
});

test('лист с неверной строкой: она пропускается и показывается на экране с причиной', () => {
  const e = env([['пн', 'Парк', '16:00', '17:00', 'U9', 'Групповая', '', 'U9-A'], ['пх', 'Парк', '16:00', '17:00', 'U9', 'Групповая', '', '']]);
  const d = e.ctx.appSchedule('9');
  assert.equal(d.rows.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(d.bad)), [{ line: 3, error: 'день недели: пн, вт, ср, чт, пт, сб или вс' }]);
});
