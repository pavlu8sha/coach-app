// План миграции #15/#16: имена обработчиков установленных триггеров не меняются.
// clasp push сразу меняет код, который выполняют установленные триггеры: если функции с именем триггера нет,
// триггер падает с «Script function not found». Тест держит три места согласованными:
// newTrigger('X') в установщиках, публичная функция X и проверка «триггеры» в SelfTest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = Object.fromEntries(fs.readdirSync(ROOT).filter(f => /\.(js|gs)$/.test(f)).map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
const all = Object.values(src).join('\n');

// Имена триггеров, которые сейчас установлены в рабочем проекте (selfTest 20.10)
const INSTALLED = ['warmUp', 'indAutoTick'];

test('установщики создают триггеры только с прежними именами', () => {
  const made = [...all.matchAll(/newTrigger\(\s*'([^']+)'\s*\)/g)].map(m => m[1]).sort();
  assert.deepEqual(made, [...INSTALLED].sort());
});

test('обработчики установленных триггеров — публичные функции верхнего уровня, ровно по одной', () => {
  for (const name of INSTALLED) {
    const defs = all.match(new RegExp('^function\\s+' + name + '\\s*\\(', 'gm')) || [];
    assert.equal(defs.length, 1, name);
  }
});

test('обработчики — тонкие обёртки над приватной функцией и ничего не возвращают', () => {
  for (const [name, file] of [['warmUp', 'Warmup.js'], ['indAutoTick', 'Individual.js']]) {
    const m = src[file].match(new RegExp('function\\s+' + name + '\\s*\\(e\\)\\s*\\{([^}]*)\\}'));
    assert.ok(m, name);
    assert.equal(m[1].trim(), name + 'Run_();', name);
    assert.match(src[file], new RegExp('function\\s+' + name + 'Run_\\s*\\('), name + 'Run_');
  }
});

test('indWeeklyCreate приватная: создание занятий нельзя вызвать извне в обход дня и часа', () => {
  assert.match(src['Individual.js'], /function\s+indWeeklyCreate_\s*\(/);
  assert.doesNotMatch(all, /function\s+indWeeklyCreate\s*\(/);
  assert.match(src['Individual.js'], /function indAutoTickRun_\(\) \{[\s\S]*?\bindWeeklyCreate_\(\);/);
});

test('selfTest проверяет те же имена, что создают установщики', () => {
  const checked = [...src['SelfTest.js'].matchAll(/h\.indexOf\('([^']+)'\) < 0/g)].map(m => m[1]).sort();
  assert.deepEqual(checked, [...INSTALLED].sort());
});
