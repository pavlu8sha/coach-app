import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('scheduled handlers are private and installers target the private names', () => {
  const individual = fs.readFileSync(path.join(ROOT, 'Individual.js'), 'utf8');
  const warmup = fs.readFileSync(path.join(ROOT, 'Warmup.js'), 'utf8');
  const selfTest = fs.readFileSync(path.join(ROOT, 'SelfTest.js'), 'utf8');

  for (const name of ['indAutoTick', 'indWeeklyCreate']) {
    assert.match(individual, new RegExp('function\\s+' + name + '_\\s*\\('));
    assert.doesNotMatch(individual, new RegExp('function\\s+' + name + '\\s*\\('));
  }
  assert.match(individual, /newTrigger\('indAutoTick_'\)/);
  assert.match(individual, /h === 'indWeeklyCreate_' \|\| h === 'indAutoTick_'/);
  assert.match(warmup, /function\s+warmUp_\s*\(/);
  assert.doesNotMatch(warmup, /function\s+warmUp\s*\(/);
  assert.match(warmup, /newTrigger\('warmUp_'\)/);
  assert.match(selfTest, /getHandlerFunction\(\).*'warmUp_'/);
  assert.match(selfTest, /getHandlerFunction\(\).*'indAutoTick_'/);
});
