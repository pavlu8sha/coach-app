// Взнос за чемпионат в связанных формах: создание события (appAddEvent → addEventCore_) и подсказка в форме
// (appMatchesData → champFee). Реальные Settings.js, MatchesEdit.js, MatchesV3.js; таблицы — имитация.
// Суммы в фикстурах не совпадают с реальными взносами клуба.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = 'matches.champFee';

class Sheet {
  constructor(rows) { this.data = rows.map(r => r.slice()); }
  getLastRow() { return this.data.length; }
  getParent() { return { getSpreadsheetTimeZone: () => 'Asia/Tbilisi' }; }
  getRange(r, c, n = 1, m = 1) {
    const sh = this;
    const cell = (a, b) => { const x = sh.data[a - 1]; return x && x[b - 1] !== undefined ? x[b - 1] : ''; };
    const grid = f => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(r + i, c + j)));
    return {
      getValues: () => grid(cell),
      getDisplayValues: () => grid((a, b) => String(cell(a, b))),
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => {
        while (sh.data.length < r + i) sh.data.push([]);
        const rr = sh.data[r + i - 1]; while (rr.length < c + j) rr.push(''); rr[c + j - 1] = x;
      })),
      setNumberFormat() { return this; },
    };
  }
  deleteRow(i) { this.data.splice(i - 1, 1); }
}

function env(rows) {
  const settings = rows ? new Sheet([['Ключ', 'Объект', 'Значение', 'Изменено']].concat(rows)) : null;
  const matches = new Sheet([['ID', 'Команда', 'Тип', 'Название', 'Дата', 'Взнос', 'Турнир']]);
  const parts = new Sheet([['Событие', 'ID игрока', 'ФИ']]);
  const props = { APP_ADMIN_PIN: '9', APP_PIN: '1', SET_VER: '0' }, cache = {}, fees = {};
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, CONFIG: { DRY_RUN: false },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: () => '' },
  };
  vm.createContext(ctx);
  for (const f of ['Settings.js', 'MatchesEdit.js', 'MatchesV3.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const pl = fs.readFileSync(path.join(ROOT, 'Players.js'), 'utf8');               // padId_ — настоящая функция из Players.js
  vm.runInContext(pl.slice(pl.indexOf('function padId_'), pl.indexOf('}', pl.indexOf('return prefix + s;')) + 1), ctx);
  Object.assign(ctx, {
    dbRead_: n => (n === 'НАСТРОЙКИ' ? settings : null),
    dbSheet_: (n, h) => settings || (ctx.__s = new Sheet([h])),
    checkAdmin_: p => { if (String(p) !== '9') throw new Error('Неверный код администратора'); },
    checkAny_: p => { if (!['9', '1'].includes(String(p))) throw new Error('Неверный код доступа'); },
    appWho: p => (String(p) === '9' ? 'admin' : 'trainer'),
    prop_: k => props[k], cacheDropBig_() {}, logChange_() {}, serialOf: () => 46300,
    sheetOf_: n => (n === 'МАТЧИ' ? matches : null), partsSheet_: () => parts,
    feeSet_: (id, team, type, name, fee) => { if (Number(fee) > 0) fees[id] = Number(fee); },
    gnSyncGameSafe_: () => '',
    matchesData_: () => ({ events: matches.data.slice(1).map(r => ({ id: r[0], team: r[1], type: r[2] })), parts: [] }),
    finData_: () => ({ fees, pays: {} }),
  });
  if (!settings) ctx.dbSheet_ = (n, h) => (ctx.__s = ctx.__s || new Sheet([h]));
  if (!settings) ctx.dbRead_ = n => (n === 'НАСТРОЙКИ' ? ctx.__s || null : null);
  const champ = (team, pin = '9', fee = '') => ctx.appAddEvent(pin, { type: 'Чемпионат', team, name: 'Championship 1', fee });
  return { ctx, fees, champ, newRun: () => vm.runInContext('_settingsRun = null;', ctx) };
}

test('общий взнос: чемпионат новой команды без исключения получает общий; U13-A с исключением — своё', () => {
  const e = env([[F, '', '250'], [F, 'U13-A', '375']]);
  const a = e.champ('U15-Z'), b = e.champ('U13-A'), c = e.champ('U10-A');
  assert.deepEqual([e.fees[a.id], e.fees[b.id], e.fees[c.id]], [250, 375, 250]);
  assert.equal(a.feeWarning, '');
});

test('взнос не настроен: событие создаётся без взноса и с предупреждением, суммы из кода нет', () => {
  const e = env();
  const r = e.champ('U13-A');
  assert.equal(e.fees[r.id], undefined);
  assert.match(r.feeWarning, /не настроен.*создано без взноса/);
  const d = e.ctx.appMatchesData('9');
  assert.equal(d.champFee.def, null);
});

test('неверное значение команды: событие без взноса и предупреждение «неверное значение», общее не подставляется', () => {
  const e = env([[F, '', '250'], [F, 'U13-A', 'abc']]);
  const r = e.champ('U13-A');
  assert.equal(e.fees[r.id], undefined);
  assert.match(r.feeWarning, /неверное значение/);
});

test('админ ввёл взнос в форме — используется он, настройка не мешает', () => {
  const e = env([[F, '', '250']]);
  const r = e.champ('U13-A', '9', '99');
  assert.equal(e.fees[r.id], 99);
});

test('после изменения настройки новое значение сразу и в создании события, и в подсказке формы', () => {
  const e = env();
  assert.equal(e.ctx.appMatchesData('9').champFee.def, null);
  e.ctx.appSettingsSave('9', F, '', 250);
  e.ctx.appSettingsSave('9', F, 'U13-A', 375);
  const d1 = e.ctx.appMatchesData('9').champFee;
  assert.equal(d1.def, 250); assert.equal(d1.byTeam['u13-a'], 375);
  assert.equal(e.fees[e.champ('U13-A').id], 375);
  e.ctx.appSettingsSave('9', F, 'U13-A', '');                         // вернуть U13-A к общему
  e.newRun();                                                          // следующий запрос
  assert.equal(e.fees[e.champ('U13-A').id], 250);
  assert.equal(e.ctx.appMatchesData('9').champFee.byTeam['u13-a'], undefined);
});

test('тренер: событие создаётся по настройке, но денежной подсказки в ответе нет', () => {
  const e = env([[F, '', '250']]);
  const r = e.champ('U9', '1');
  assert.equal(e.fees[r.id], 250);
  assert.equal(e.ctx.appMatchesData('1').champFee, undefined);
});
