// Этап 3 настроек: порядок групп, метка тарифа сбора, темы и автосоздание индивидуальных, день «следующего месяца»,
// надпись/номер по флагам каталога. Настоящие Settings.js, MonthsAtt.js, Camps.js, Individual.js; Kit.html — missOf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

function env(rows, extra = {}) {
  const data = [['Ключ', 'Объект', 'Значение', 'Изменено']].concat(rows || []);
  const props = {}, cache = {};
  const ctx = Object.assign({
    console: { warn() {}, error() {}, log() {} }, CONFIG: { DRY_RUN: false },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove() {} }) },
  }, extra);
  vm.createContext(ctx);
  for (const f of ['Settings.js', 'MonthsAtt.js', 'Camps.js', 'Individual.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  ctx.norm = norm;
  ctx.dbRead_ = () => ({ getLastRow: () => data.length, getRange: (r, c, n = 1, m = 1) => ({ getDisplayValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => String((data[r - 1 + i] || [])[c - 1 + j] ?? ''))) }) });
  return { ctx, props };
}

test('порядок групп: по умолчанию прежний; настройка меняет порядок листа и списка сбора', () => {
  const a = env().ctx;
  assert.deepEqual([a.groupRank_('U7-A'), a.groupRank_('Isani'), a.groupRank_('U15')], [0, 13, 999]);
  assert.deepEqual([...a.campListOrder_()], ['U7', 'U9', 'U10', 'U11', 'U13', 'weekends', 'Ortachala U9', 'Ortachala U12', 'Isani']);
  const b = env([['att.groupOrder', '', 'Isani, U7-A, U7-B']]).ctx;
  assert.deepEqual([b.groupRank_('Isani'), b.groupRank_('U7-B'), b.groupRank_('U9-A')], [0, 2, 999]);
  assert.deepEqual([...b.campListOrder_()], ['Isani', 'U7']);
});

test('метка тарифа сбора: своя из колонки, без неё — как раньше по словам', () => {
  const c = env().ctx;
  assert.equal(c.campSuffix_('Ребёнок + 2 родителя', ''), '1+2');
  assert.equal(c.campSuffix_('Футболист', ''), 'футболист');
  assert.equal(c.campSuffix_('Семья', 'семья 3'), 'семья 3');
  assert.equal(c.campSuffix_('Новый тариф', ''), 'Новый тариф');
});

test('день недели в настройке: пн…вс, неверное — ошибка', () => {
  const c = env().ctx;
  assert.equal(c.settingGet_('ind.autoDay'), 'вт');
  assert.equal(env([['ind.autoDay', '', 'Среда']]).ctx.settingGet_('ind.autoDay'), 'ср');
  const bad = env([['ind.autoDay', '', 'xx']]).ctx.settingResolve_('ind.autoDay');
  assert.equal(bad.value, 'вт');                           // неверное значение — действует «по умолчанию», ошибка видна
  assert.match(String(bad.errors), /день недели/);
});

test('автосоздание: в день и час из настроек и только раз в день', () => {
  let made = 0, now = '2026-10-20 08:30';   // вторник
  const days = { '2026-10-20': 2, '2026-10-21': 3 };
  const fmt = (d, tz, f) => { const [dd, hh] = now.split(' '); return f === 'u' ? String(days[dd] || 7) : f === 'H' ? String(Number(hh.split(':')[0])) : dd; };
  const e = env([['ind.autoHour', '', '9']], { Session: { getScriptTimeZone: () => 'Asia/Tbilisi' }, Utilities: { formatDate: fmt } });
  e.ctx.indWeeklyCreate = () => { made++; };
  e.ctx.indAutoTick_(); assert.equal(made, 0);              // 8:30 — рано
  now = '2026-10-20 09:05'; e.ctx.indAutoTick_(); assert.equal(made, 1);
  now = '2026-10-20 10:05'; e.ctx.indAutoTick_(); assert.equal(made, 1);   // второй раз за день — нет
  now = '2026-10-21 09:05'; e.ctx.indAutoTick_(); assert.equal(made, 1);   // среда — не тот день
});

test('темы индивидуальных — из настройки, по кругу', () => {
  const e = env([['ind.themes', '', 'А, Б']], { Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) } });
  assert.equal(e.ctx.indAutoTheme_('2026-10-24', []), 'А');
  assert.equal(e.ctx.indAutoTheme_('2026-10-31', [{ date: '2026-10-24', theme: 'А', goalkeepers: false }]), 'Б');
});

test('форма экипировки: надпись и номер по флагам каталога (как в боевом каталоге)', () => {
  const s = fs.readFileSync(path.join(ROOT, 'Kit.html'), 'utf8');
  const a = s.indexOf('function missOf(o){'), b = s.indexOf('\n}\n', a) + 3;
  const ctx = { nn: x => String(x).trim().toLowerCase(), FL: {
    'тренировочная форма': { inscr: false, num: true }, 'игровая форма': { inscr: true, num: true }, 'носки': { inscr: false, num: false },
    'гетры': { inscr: false, num: false }, 'спортивный костюм': { inscr: false, num: true }, 'дождевик': { inscr: false, num: true } } };
  vm.createContext(ctx); vm.runInContext(s.slice(a, b), ctx);
  const miss = kit => [...ctx.missOf({ kit, sum: 100, size: 'M', num: '', inscr: '' })];
  assert.deepEqual(miss('Носки + Гетры'), []);
  assert.deepEqual(miss('Тренировочная форма'), ['номер']);
  assert.deepEqual(miss('Игровая форма + Тренировочная форма'), ['номер', 'надпись']);
  assert.deepEqual(miss('Дождевик + Тренировочная форма'), ['номер']);            // в каталоге надпись у них не нужна
  assert.deepEqual(miss('тренировочная & игровая'), ['номер', 'надпись']);         // не из каталога — нужны оба
});
