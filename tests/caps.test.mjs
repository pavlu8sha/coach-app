// Лимиты мест из настроек: индивидуальные (6), вратарские (7), дополнительные (0 — без ограничения).
// Настоящие Settings.js, Individual.js, Extra.js; таблицы — имитация.
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
  getRange(r, c, n = 1, m = 1) {
    const sh = this;
    const cell = (a, b) => { const x = sh.data[a - 1]; return x && x[b - 1] !== undefined ? x[b - 1] : ''; };
    const grid = f => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(r + i, c + j)));
    const rg = {
      getValues: () => grid(cell), getDisplayValues: () => grid((a, b) => String(cell(a, b))),
      setValues: v => { v.forEach((row, i) => row.forEach((x, j) => { while (sh.data.length < r + i) sh.data.push([]); const rr = sh.data[r + i - 1]; while (rr.length < c + j) rr.push(''); rr[c + j - 1] = x; })); return rg; },
      setValue: x => rg.setValues([[x]]), setNumberFormat: () => rg, copyTo() {},
    };
    return rg;
  }
  insertRowAfter() {}
}

function env(settingsRows) {
  const settings = new Sheet([['Ключ', 'Объект', 'Значение', 'Изменено']].concat(settingsRows || []));
  const props = { SET_VER: '0' }, cache = {}, enrolled = [];
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, CONFIG: { DRY_RUN: false },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  };
  vm.createContext(ctx);
  for (const f of ['Settings.js', 'Individual.js', 'Extra.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const extraSheet = new Sheet([[]]);
  Object.assign(ctx, {
    dbRead_: n => (n === 'НАСТРОЙКИ' ? settings : null),
    indNotOld_() {}, indPfEnroll_: (d, name) => enrolled.push(name), indLog_() {}, extraLog_() {},
    extraSS_: () => ({ getSheetByName: () => extraSheet }),
  });
  const ev = (n, gk) => ({ goalkeepers: !!gk, date: '2026-10-25', players: Array.from({ length: n }, (_, i) => ({ name: 'P' + i })), empty: [5], slots: n, last: 4, sheet: 'x' });
  return { ctx, enrolled, ev };
}

test('индивидуальное: по умолчанию 6 мест — шестой записывается, седьмой нет', () => {
  const e = env();
  e.ctx.indPutPlayer_(e.ev(5), 'New', 'U9');
  assert.deepEqual([...e.enrolled], ['New']);
  assert.throws(() => e.ctx.indPutPlayer_(e.ev(6), 'New2', 'U9'), /Мест нет: максимум 6/);
});

test('вратарское: по умолчанию 7 мест', () => {
  const e = env();
  e.ctx.indPutPlayer_(e.ev(6, true), 'Gk', 'U9');
  assert.throws(() => e.ctx.indPutPlayer_(e.ev(7, true), 'Gk2', 'U9'), /максимум 7/);
});

test('лимиты из настроек: индивидуальное 4, вратарское 5', () => {
  const e = env([['ind.capIndividual', '', '4'], ['ind.capGoalkeepers', '', '5']]);
  assert.throws(() => e.ctx.indPutPlayer_(e.ev(4), 'X', 'U9'), /максимум 4/);
  assert.throws(() => e.ctx.indPutPlayer_(e.ev(5, true), 'X', 'U9'), /максимум 5/);
  e.ctx.indPutPlayer_(e.ev(3), 'Y', 'U9');
  assert.deepEqual([...e.enrolled], ['Y']);
});

test('дополнительные: по умолчанию без ограничения, с настройкой — лимит', () => {
  const a = env();
  a.ctx.extraPut_(a.ev(100), 'Z', 'U9');                         // 0 — без ограничения
  const b = env([['extra.cap', '', '18']]);
  assert.throws(() => b.ctx.extraPut_(b.ev(18), 'Z', 'U9'), /Мест нет: максимум 18/);
  b.ctx.extraPut_(b.ev(17), 'Z', 'U9');
});

test('неверное значение лимита в листе — действует значение по умолчанию', () => {
  const e = env([['ind.capIndividual', '', 'abc']]);
  assert.throws(() => e.ctx.indPutPlayer_(e.ev(6), 'X', 'U9'), /максимум 6/);
});
