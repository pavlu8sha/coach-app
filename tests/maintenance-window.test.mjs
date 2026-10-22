// Окно обслуживания MAINT_UNTIL: установщики триггеров работают только в нём.
// Настоящие Maint.js, Warmup.js, Individual.js; ScriptApp, свойства и время — имитация.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function env(until, now = '2026-10-22 12:00') {
  const props = until === undefined ? {} : { MAINT_UNTIL: until };
  let triggers = [{ h: 'warmUp' }, { h: 'indAutoTick' }, { h: 'indWeeklyCreate' }];
  const created = [], deleted = [];
  const builder = h => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => { created.push(h); triggers.push({ h }); } }),
    everyHours: () => ({ create: () => { created.push(h); triggers.push({ h }); } }) }) });
  const ctx = {
    console: { warn() {}, error() {}, log() {} }, Logger: { log() {} }, CONFIG: { DRY_RUN: false },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    Session: { getScriptTimeZone: () => 'Asia/Tbilisi' },
    Utilities: { formatDate: (d, tz, f) => { assert.equal(f, 'yyyy-MM-dd HH:mm'); return now; } },
    ScriptApp: {
      getProjectTriggers: () => triggers.map(t => ({ getHandlerFunction: () => t.h, _t: t })),
      deleteTrigger: x => { deleted.push(x._t.h); triggers = triggers.filter(t => t !== x._t); },
      newTrigger: h => builder(h),
    },
    settingGet_: k => (k === 'ind.autoDay' ? 'вт' : 9),
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  for (const f of ['Maint.js', 'Warmup.js', 'Individual.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return { ctx, created, deleted, handlers: () => triggers.map(t => t.h).sort() };
}

const CLOSED = /Окно обслуживания закрыто/;

test('окно не задано, в прошлом, слишком далеко или в неверном формате — установщики ничего не трогают', () => {
  for (const until of [undefined, '', '2026-10-22 11:59', '2026-10-22 13:01', '2026-10-23 12:30', '22.10.2026 12:30', '2026-10-22 25:00', 'да']) {
    const e = env(until);
    assert.throws(() => e.ctx.installWarmTrigger(), CLOSED, String(until));
    assert.throws(() => e.ctx.indInstallTrigger(), CLOSED, String(until));
    assert.deepEqual([e.created, e.deleted], [[], []], String(until));
  }
});

test('открытое окно: установщики пересоздают триггеры с прежними именами warmUp и indAutoTick', () => {
  const e = env('2026-10-22 12:30');
  assert.equal(e.ctx.installWarmTrigger(), undefined);
  assert.equal(e.ctx.indInstallTrigger(), undefined);
  assert.deepEqual(e.created, ['warmUp', 'indAutoTick']);
  assert.deepEqual(e.handlers(), ['indAutoTick', 'warmUp']);          // старый indWeeklyCreate удалён, дублей нет
});

test('граница окна: ровно сейчас и ровно через 60 минут — открыто; формат с T тоже принимается', () => {
  for (const until of ['2026-10-22 12:00', '2026-10-22 13:00', '2026-10-22T12:10']) {
    const e = env(until);
    e.ctx.installWarmTrigger();
    assert.deepEqual(e.created, ['warmUp'], until);
  }
});

test('окно через полночь считается правильно', () => {
  const e = env('2026-10-23 00:20', '2026-10-22 23:50');
  e.ctx.indInstallTrigger();
  assert.deepEqual(e.created, ['indAutoTick']);
});
