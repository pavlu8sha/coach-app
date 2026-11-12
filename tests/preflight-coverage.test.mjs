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

test('preflight.sql использует статусы и не советует применять всё подряд', () => {
  for (const status of ['APPLIED', 'SUPERSEDED', 'NOT_APPLIED', 'UNKNOWN']) {
    assert.match(preflight, new RegExp(`\\b${status}\\b`), `нет статуса ${status}`);
  }
  assert.doesNotMatch(preflight, /применять все\s+applied\s*=\s*false/i);
  assert.match(preflight, /coalesce\(o\.status, case when m\.applied then 'APPLIED' else 'NOT_APPLIED' end\)/);
});

test('preflight.sql не угадывает объекты через pg_proc limit 1 и не теряет схему', () => {
  assert.doesNotMatch(preflight, /from\s+pg_proc[\s\S]*?limit\s+1/i);
  assert.doesNotMatch(preflight, /to_reg(class|procedure|proc)\('(?!public\.)/);
  assert.doesNotMatch(preflight, /pg_policies\s+where\s+tablename/i);
  for (const [i, line] of preflight.split(/\r?\n/).entries()) {
    if (!/information_schema\.(columns|tables)/.test(line)) continue;
    const schema = line.indexOf("table_schema = 'public'");
    const table = line.indexOf('table_name');
    assert.ok(schema >= 0 && table > schema, `information_schema без схемы public в строке ${i + 1}`);
  }
});

test('preflight.sql содержит безопасные проверки привилегий и замен', () => {
  assert.match(preflight, /from pg_proc p where p\.oid = to_regprocedure\('public\.notify_data_request\(\)'\)/);
  assert.match(preflight, /from pg_class c where c\.oid = to_regclass\('public\.camp_payments'\)/);
  assert.match(preflight, /from pg_class c where c\.oid = to_regclass\('public\.individual_templates'\)/);
  assert.match(preflight, /from pg_proc p where p\.oid = to_regprocedure\('public\.match_duration_minutes\(\)'\)/);
  assert.match(preflight, /from pg_proc[\s\S]*?to_regprocedure\('public\.claim_notifications\(integer\)'\)/);
});

test('preflight.sql различает замену и неопределённость для проблемных миграций', () => {
  const overrides = preflight.match(/overrides\(migration, status\) as \(([\s\S]*?)\n\)\n-- note/);
  assert.ok(overrides, 'нет блока overrides');
  for (const migration of [
    '0047_ind_no_autobook',
    '0052_ind_change_type',
    '0081_match_stats_drop_old_overload',
    '0091_event_list_players_count',
    '0173_consent_access',
  ]) {
    assert.match(overrides[1], new RegExp(`'${migration}'`));
  }
  assert.match(overrides[1], /'SUPERSEDED'/);
  assert.match(overrides[1], /'UNKNOWN'/);
  assert.doesNotMatch(overrides[1], /count\(distinct proname\)/);
  assert.match(overrides[1], /to_regprocedure\('public\.parent_access_ok\(uuid,uuid\)'\)/);
  assert.match(overrides[1], /to_regprocedure\('public\.decide_link\(uuid,boolean\)'\)/);
  assert.match(overrides[1], /to_regprocedure\('public\.revoke_consent\(uuid\)'\)/);
  assert.match(overrides[1], /to_regprocedure\('public\.export_my_data\(\)'\)/);
});

test('run-db-tests.sh проверяет статусы, а не скрывает 0047/0052', () => {
  const runner = fs.readFileSync(path.join(ROOT, 'scripts/run-db-tests.sh'), 'utf8');
  assert.doesNotMatch(runner, /0047_ind_no_autobook\|0052_ind_change_type/);
  assert.match(runner, /SUPERSEDED/);
  assert.match(runner, /0176_consent_claim_check\|t\|APPLIED\|applied/);
});
