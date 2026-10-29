// Каждая миграция из db/migrations должна иметь проверку «применена» в db/ops/preflight.sql:
// иначе владелец запускает preflight и не видит, что новая миграция ещё не применена (так 0065–0069 остались без проверок).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrations = fs.readdirSync(path.join(ROOT, 'db/migrations')).filter(f => /^\d{4}_.*\.sql$/.test(f)).map(f => f.replace(/\.sql$/, '')).sort();
const preflight = fs.readFileSync(path.join(ROOT, 'db/ops/preflight.sql'), 'utf8');
const covered = new Set([...preflight.matchAll(/^\s*\('(\d{4}_[^']+)'/gm)].map(m => m[1]));

test('preflight.sql проверяет каждую миграцию из db/migrations', () => {
  const missing = migrations.filter(m => !covered.has(m));
  assert.deepEqual(missing, [], `Добавьте строки в db/ops/preflight.sql для: ${missing.join(', ')}`);
});

test('в preflight.sql нет проверок несуществующих миграций и дублей', () => {
  const extra = [...covered].filter(m => !migrations.includes(m));
  assert.deepEqual(extra, []);
  const all = [...preflight.matchAll(/^\s*\('(\d{4}_[^']+)'/gm)].map(m => m[1]);
  assert.equal(all.length, new Set(all).size, 'дубли строк в preflight.sql');
});
