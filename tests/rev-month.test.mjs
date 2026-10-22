// revMonth_ — одна на проект (раньше две: MonthsCode.js и SubsCode.js; в Apps Script действует последняя по порядку файлов).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('в проекте одно определение revMonth_ — в SubsCode.js', () => {
  const files = fs.readdirSync(ROOT).filter(f => /\.(js|gs)$/.test(f));
  const defs = files.filter(f => /function\s+revMonth_\s*\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(defs, ['SubsCode.js']);
});

test('revMonth_: «мм.гг» → «ггмм», порядок месяцев через год — как раньше', () => {
  const ctx = {};
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(ROOT, 'SubsCode.js'), 'utf8'), s = src.indexOf('function revMonth_');
  vm.runInContext(src.slice(s, src.indexOf('\n', s)), ctx);
  const old = m => m.split('.').reverse().join('');                    // прежняя версия из MonthsCode.js
  for (const m of ['01.26', '09.26', '10.26', '12.26', '01.27']) assert.equal(ctx.revMonth_(m), old(m));
  assert.deepEqual(['01.27', '10.26', '09.26', '12.26'].sort((a, b) => ctx.revMonth_(a).localeCompare(ctx.revMonth_(b))), ['09.26', '10.26', '12.26', '01.27']);
});
