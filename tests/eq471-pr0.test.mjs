// #471 PR-0: read-only сверка экипировки и защита тестов базы от удалённого сервера.
// Условия: docs/acceptance/eq-471-pr0-baseline-2026-11-12.md (Б7, Б9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url).pathname;
const sqlRaw = readFileSync(`${root}db/ops/readonly-eq-baseline-471.sql`, 'utf8');
// без комментариев и строковых литералов: ключевые слова ищем только в коде запроса
const code = sqlRaw.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"])*"/g, '""');

test('Б7: в файле один запрос, он начинается с with/select', () => {
  const stmts = code.split(';').map(s => s.trim()).filter(Boolean);
  assert.equal(stmts.length, 1);
  assert.match(stmts[0], /^(with|select)\b/i);
});

test('Б7: нет операций записи, DDL и управления транзакциями', () => {
  const bad = /\b(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|comment|copy|call|do|vacuum|analyze|refresh|lock|set|reset|begin|commit|rollback|savepoint|notify|listen|security|execute|prepare)\b/i;
  const m = code.match(bad);
  assert.equal(m, null, m ? `найдено: ${m[0]}` : '');
});

test('Б7: вызываются только встроенные функции PostgreSQL, функций приложения нет', () => {
  const calls = [...code.matchAll(/\b([a-z_][a-z0-9_.]*)\s*\(/gi)].map(m => m[1].toLowerCase());
  const allowed = new Set(['coalesce', 'nullif', 'trim', 'lower', 'sum', 'count', 'string_agg', 'md5', 'concat_ws', 'to_char', 'abs', 'floor',
    'greatest', 'regexp_split_to_table', 'row_number', 'select', 'exists', 'in', 'values', 'over', 'with', 'as', 'not', 'and', 'or', 'rows', 'kid_set', 'num', 'on', 'from', 'join', 'by']);
  const unknown = [...new Set(calls)].filter(c => !allowed.has(c) && !/^(cfg|own_groups|all_groups|full_kits|o|cand|members|closing|kid|cls|jr|g|v|ag|a2|rows)$/.test(c));
  assert.deepEqual(unknown, []);
});

const guard = (env, psql) => spawnSync('bash', ['-c', `. scripts/lib/local-db-guard.sh; local_db_guard "$1"`, 'guard', psql], {
  cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8',
});

test('Б9: локальные варианты разрешены (как в CI и локальном прогоне)', () => {
  for (const [env, psql] of [[{}, 'psql'], [{}, 'psql -h /var/run/postgresql -U runner'], [{ PGHOST: 'localhost' }, 'psql'],
    [{ PGHOST: '/tmp' }, 'psql'], [{}, 'psql --host=127.0.0.1'], [{}, 'psql -h ::1'], [{}, 'psql -h/var/run/postgresql']]) {
    const r = guard(env, psql);
    assert.equal(r.status, 0, `${JSON.stringify(env)} ${psql}: ${r.stderr}`);
  }
});

test('Б9: удалённый сервер отклоняется до любых действий с базой', () => {
  for (const [env, psql] of [[{ PGHOST: 'db.abcdefgh.supabase.co' }, 'psql'], [{ PGHOSTADDR: '10.0.0.5' }, 'psql'],
    [{}, 'psql -h aws-0-eu.pooler.supabase.com'], [{}, 'psql --host=db.example.com'], [{}, 'psql -hdb.example.com'],
    [{}, 'psql postgresql://u:p@db.example.com:5432/postgres'], [{}, 'psql "host=db.example.com dbname=postgres"'],
    [{ PGSERVICE: 'prod' }, 'psql'], [{ PGDATABASE: 'postgres://x@db.example.com/y' }, 'psql']]) {
    const r = guard(env, psql);
    assert.notEqual(r.status, 0, `${JSON.stringify(env)} ${psql} должен быть отклонён`);
    assert.match(r.stderr, /Отказ/);
  }
});

test('Б9: run-db-tests.sh вызывает защиту до первой команды psql', () => {
  const s = readFileSync(`${root}scripts/run-db-tests.sh`, 'utf8');
  const g = s.indexOf('local_db_guard "$PSQL" || exit 2');
  const p = s.indexOf('$PSQL -q');
  assert.ok(g > 0 && p > g);
  const r = spawnSync('bash', ['scripts/run-db-tests.sh'], { cwd: root, env: { PATH: process.env.PATH, PGHOST: 'db.example.com', PSQL: 'false' }, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Отказ/);
});
