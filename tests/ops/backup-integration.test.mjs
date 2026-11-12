// Интеграционные проверки скриптов резервного копирования на локальном PostgreSQL (REL-01, замечания к PR #621).
// Запускаются, только если задан BACKUP_IT_PG_URL (локальный сервер без имени базы, например
// postgresql://runner@localhost:5432) и есть pg_dump, psql, pg_restore, age, age-keygen. Иначе пропускаются.
// Против Supabase не запускаются: restore-check сам отвергает нелокальные адреса.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.BACKUP_IT_PG_URL;
const has = cmd => spawnSync('bash', ['-c', `command -v ${cmd}`]).status === 0;
const skip = !BASE ? 'BACKUP_IT_PG_URL не задан'
  : !['pg_dump', 'psql', 'pg_restore', 'age', 'age-keygen'].every(has) ? 'нет pg_dump/psql/pg_restore/age' : false;

const rnd = Math.random().toString(16).slice(2, 8);
const SRC = `kickstart_it_src_${rnd}`;
const BYSTANDERS = ['kickstart_restore_check', `kickstart_restore_check_bystander_${rnd}`];
let tmp, key, recipient;

function psql(db, sql) {
  const r = spawnSync('psql', [`${BASE}/${db}`, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql ${db}: ${r.stderr}`);
  return r.stdout.trim();
}
const dbs = () => psql('postgres', 'select datname from pg_database order by 1').split('\n');
const ownLeftovers = () => dbs().filter(d => /^kickstart_restore_check_\d{8}_\d{6}_/.test(d));

function run(script, args, env, extraPath) {
  return spawnSync('bash', [path.join(ROOT, 'db/ops', script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: (extraPath ? extraPath + ':' : '') + process.env.PATH, HOME: tmp,
           BACKUP_ENV_FILE: path.join(tmp, 'none.env'), ...env },
  });
}
function dump(dir, env = {}, extraPath) {
  const t = fs.mkdtempSync(path.join(tmp, 'tmpdir-'));
  const r = run('backup-pg-dump.sh', [], { SUPABASE_DB_URL: `${BASE}/${SRC}`, AGE_RECIPIENT: recipient,
    BACKUP_DIR: dir, TMPDIR: t, ...env }, extraPath);
  return { ...r, tmpLeft: fs.readdirSync(t) };
}
const listFiles = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter(f => fs.statSync(path.join(dir, f)).isFile()) : [];

before(() => {
  if (skip) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kickstart-it-'));
  key = path.join(tmp, 'age-key.txt');
  const g = spawnSync('age-keygen', ['-o', key], { encoding: 'utf8' });
  recipient = (g.stderr + g.stdout).match(/age1[0-9a-z]+/)[0];
  psql('postgres', `create database ${SRC}`);
  // Источник со схемой приложения, как в scripts/run-db-tests.sh: иначе preflight.sql на восстановленной базе не выполнится.
  const files = ['db/tests/setup_local.sql',
    ...fs.readdirSync(path.join(ROOT, 'db/migrations')).filter(f => f.endsWith('.sql')).sort().map(f => `db/migrations/${f}`)];
  for (const f of files) {
    const r = spawnSync('psql', [`${BASE}/${SRC}`, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(ROOT, f)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${f}: ${r.stderr}`);
  }
  psql(SRC, 'create table public.t(id int); insert into public.t select generate_series(1, 3);');
  for (const d of BYSTANDERS) {
    if (dbs().includes(d)) throw new Error(`база ${d} уже существует, тест её не трогает: удалите вручную или смените сервер`);
    psql('postgres', `create database ${d}`);
    psql(d, "create table marker(v text); insert into marker values ('чужая база')");
  }
});

after(() => {
  if (skip) return;
  for (const d of [SRC, ...BYSTANDERS, ...ownLeftovers()]) psql('postgres', `drop database if exists "${d}"`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('дамп: в каталоге копий только файлы age, открытый дамп нигде не остаётся', { skip }, () => {
  const dir = path.join(tmp, 'ok');
  const r = dump(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const files = listFiles(dir);
  assert.equal(files.length, 2, files.join(','));
  for (const f of files) {
    assert.match(f, /\.(dump|manifest)\.age$/);
    assert.equal(fs.readFileSync(path.join(dir, f)).subarray(0, 21).toString(), 'age-encryption.org/v1');
  }
  assert.deepEqual(r.tmpLeft, [], 'временная папка с открытым дампом удалена');
});

test('сбой шифрования: копия не пишется, открытого дампа нет ни в каталоге копий, ни во временной папке', { skip }, () => {
  const shim = path.join(tmp, 'shim');
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(path.join(shim, 'age'), '#!/bin/sh\necho "age: сбой (тест)" >&2\nexit 1\n', { mode: 0o755 });
  const dir = path.join(tmp, 'agefail');
  const r = dump(dir, {}, shim);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /age не зашифровал дамп/);
  assert.deepEqual(listFiles(dir), []);
  assert.deepEqual(r.tmpLeft, []);
});

test('ALLOW_PLAIN=1 не даёт записать открытую копию даже при рабочей базе', { skip }, () => {
  const dir = path.join(tmp, 'plain');
  const r = dump(dir, { ALLOW_PLAIN: '1' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.deepEqual(listFiles(dir), []);
});

function freshDump(name) {
  const dir = path.join(tmp, name);
  const r = dump(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const f = listFiles(dir).find(x => x.endsWith('.dump.age'));
  return path.join(dir, f);
}
function bystandersIntact() {
  for (const d of BYSTANDERS) {
    assert.ok(dbs().includes(d), `база ${d} должна остаться`);
    assert.equal(psql(d, 'select v from marker'), 'чужая база');
  }
}
const restore = (file, env = {}) => run('backup-restore-check.sh', [file],
  { TEST_PG_URL: BASE, AGE_IDENTITY: key, ...env });

test('проверка восстановления проходит и не трогает существующие базы, включая kickstart_restore_check', { skip }, () => {
  const f = freshDump('rc-ok');
  const r = restore(f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ПРОЙДЕНО/);
  bystandersIntact();
  assert.deepEqual(ownLeftovers(), [], 'своя тестовая база удалена');
});

test('проверка восстановления при расхождении: код 1, чужие базы целы, своя удалена', { skip }, () => {
  const f = freshDump('rc-bad');
  const mfEnc = f.replace(/\.dump\.age$/, '.manifest.age');
  const plain = path.join(tmp, 'm.txt');
  assert.equal(spawnSync('age', ['-d', '-i', key, '-o', plain, mfEnc]).status, 0);
  fs.writeFileSync(plain, fs.readFileSync(plain, 'utf8').replace(/^t\|3$/m, 't|4'));
  fs.rmSync(mfEnc);
  assert.equal(spawnSync('age', ['-r', recipient, '-o', mfEnc, plain]).status, 0);
  const r = restore(f);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /счётчики строк не совпадают/);
  bystandersIntact();
  assert.deepEqual(ownLeftovers(), []);
});

test('KEEP_RESTORE_DB=1 оставляет только свою базу этого запуска', { skip }, () => {
  const f = freshDump('rc-keep');
  const r = restore(f, { KEEP_RESTORE_DB: '1' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const left = ownLeftovers();
  assert.equal(left.length, 1, left.join(','));
  assert.equal(psql(left[0], 'select count(*) from public.t'), '3');
  bystandersIntact();
  psql('postgres', `drop database "${left[0]}"`);
});
