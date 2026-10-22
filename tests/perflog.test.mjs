// Замеры (PerfLog.js): результат и ошибки не меняются, в журнал — только метки, время и hit/miss ключей кэша.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function env() {
  const lines = [];
  const ctx = { console: { log: s => lines.push(s) } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'PerfLog.js'), 'utf8'), ctx);
  vm.runInContext('PERF_LOG = true;', ctx); // тесты проверяют замер, в проде по умолчанию выключено
  return { ctx, lines };
}

test('одна строка на запрос: вложенные части, hit/miss без номера месяца, результат не меняется', () => {
  const { ctx, lines } = env();
  const r = ctx.perfSpan_('appAttInit', () => {
    ctx.perfCache_('reg_v1', true);
    ctx.perfCache_('cola_10.26', false);
    ctx.perfCache_('cola_11.26', false);
    return ctx.perfSpan_('appRoster', () => ({ roster: [{ name: 'Secret Name', id: 'KS-0001' }] }));
  });
  assert.equal(r.roster[0].id, 'KS-0001');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[perf\] appAttInit \| всего \d+ мс \| appRoster \d+ \| кэш: reg_v1 hit, cola miss ×2$/);
  assert.doesNotMatch(lines[0], /Secret|KS-0001/);
});

test('ошибка пробрасывается как была, строка всё равно пишется; следующий запрос — с чистого листа', () => {
  const { ctx, lines } = env();
  assert.throws(() => ctx.perfSpan_('appEquipOrders', () => { throw new Error('Неверный код администратора'); }), /Неверный код/);
  assert.equal(lines.length, 1);
  ctx.perfSpan_('appStatsRange', () => 1);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^\[perf\] appStatsRange \| всего \d+ мс$/);
});

test('выключено: ничего не пишется, функция выполняется', () => {
  const { ctx, lines } = env();
  vm.runInContext('PERF_LOG = false', ctx);
  assert.equal(ctx.perfSpan_('x', () => 42), 42);
  ctx.perfCache_('reg_v1', true);
  assert.equal(lines.length, 0);
});
