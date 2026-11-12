// Статические проверки скриптов резервного копирования (REL-01). Условия: db/ops/BACKUP_ACCEPTANCE.md.
// Подключения к базе нет: проверяем текст скриптов и синтаксис bash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const dump = read('db/ops/backup-pg-dump.sh');
const restore = read('db/ops/backup-restore-check.sh');
const counts = read('db/ops/backup-manifest-counts.sql');
const docs = read('db/ops/BACKUP.md');
const scripts = [dump, restore];

test('скрипты проходят bash -n', () => {
  for (const f of ['db/ops/backup-pg-dump.sh', 'db/ops/backup-restore-check.sh']) {
    const r = spawnSync('bash', ['-n', path.join(ROOT, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('в скриптах и документе нет строк подключения с паролем', () => {
  const re = /postgres(ql)?:\/\/[^\s'"`:@/]+:[^\s'"`@]+@/;
  for (const [name, text] of [['backup-pg-dump.sh', dump], ['backup-restore-check.sh', restore], ['BACKUP.md', docs]]) {
    const m = text.match(re);
    // В документе допустим только плейсхолдер <пароль>
    assert.equal(m && !/<пароль>|<ref>|…/.test(m[0]) ? m[0] : null, null, `${name}: похоже на пароль в строке подключения`);
  }
});

test('дамп пишется в custom-формате, без владельца; шифрование отключить нечем', () => {
  assert.match(dump, /--format=custom/);
  assert.match(dump, /--no-owner/);
  assert.match(dump, /ALLOW_PLAIN не поддерживается/);
  // Ни одной ветки, где копия пишется без age
  assert.doesNotMatch(dump, /без шифрования \(ALLOW_PLAIN=1\)/);
  assert.doesNotMatch(dump, /final="\$base\.dump"/);
});

test('открытый дамп пишется только во временную папку с правами 700, в BACKUP_DIR только .age', () => {
  assert.match(dump, /umask 077/);
  assert.match(dump, /mktemp -d/);
  assert.match(dump, /plain="\$work\//);
  assert.match(dump, /-f "\$plain"/);
  assert.match(dump, /age-encryption\.org\/v1/);
  // В каталоге копий не появляется файл с расширением .dump без .age
  assert.doesNotMatch(dump, /"\$base\.dump"(?!\.age)/);
});

test('дамп охватывает схемы public, auth, storage, cron и snap_*', () => {
  for (const s of ['-n public', '-n auth', '-n storage', '-n cron', "-n 'snap_*'"]) {
    assert.ok(dump.includes(s), `нет ${s}`);
  }
});

test('каталог копий не может быть внутри репозитория', () => {
  assert.match(dump, /REPO_ROOT/);
  assert.match(dump, /BACKUP_DIR внутри репозитория/);
});

test('версия клиента не может быть старше сервера', () => {
  assert.match(dump, /show server_version_num/);
  assert.match(dump, /client_major" -lt "\$server_major/);
});

test('ротация: daily 14 дней, weekly 8 недель, premigration не удаляется', () => {
  assert.match(dump, /KEEP_DAILY:-14/);
  assert.match(dump, /KEEP_WEEKLY:-8/);
  assert.match(dump, /if \[ "\$BACKUP_KIND" = daily \]/);
  // Удаление только в daily и weekly
  const deletes = dump.match(/-delete/g) || [];
  assert.equal(deletes.length, 2);
});

test('pg_restore -l проверяет дамп до шифрования, готовые файлы появляются через переименование', () => {
  const lIdx = dump.indexOf('"$PG_RESTORE" -l "$plain"');
  const encIdx = dump.indexOf('age -r "$AGE_RECIPIENT" -o "$base.dump.age.partial"');
  const mvIdx = dump.indexOf('mv "$base.dump.age.partial" "$base.dump.age"');
  assert.ok(lIdx > 0 && encIdx > lIdx && mvIdx > encIdx, 'порядок: pg_restore -l, age, mv');
});

test('проверка восстановления не работает с Supabase и только с localhost', () => {
  assert.match(restore, /\*supabase\*\|\*pooler\*/);
  assert.match(restore, /TEST_PG_URL должен указывать на localhost/);
});

test('проверка восстановления сверяет sha256, счётчики и запускает preflight', () => {
  assert.match(restore, /sha256:/);
  assert.match(restore, /diff "\$work\/expected.counts" "\$work\/restored.counts"/);
  assert.match(restore, /db\/ops\/preflight\.sql/);
  assert.match(restore, /grep -c 'error:'/);
});

test('проверка восстановления не удаляет чужие базы: имя уникальное, удаляется только своя помеченная база', () => {
  assert.doesNotMatch(restore, /drop database if exists/);
  assert.doesNotMatch(restore, /^DB=kickstart_restore_check$/m);
  assert.match(restore, /DB="kickstart_restore_check_\$run_id"/);
  assert.match(restore, /\[ "\$created" = 1 \] \|\| return 0/);
  assert.match(restore, /comment on database/);
  assert.match(restore, /if \[ "\$c" = "\$MARK" \]/);
  // create database без if not exists: занятое имя — ошибка, а не повторное использование
  assert.match(restore, /create database \\"\$DB\\"" \|\| die/);
});

test('проверка восстановления принимает только зашифрованный дамп', () => {
  assert.match(restore, /\*\.dump\.age\) ;; \*\) die/);
});

test('проверка восстановления выходит с ненулевым кодом при ошибках', () => {
  assert.match(restore, /fail\(\) \{ echo "НЕ ПРОЙДЕНО: \$\*" >&2; exit 1; \}/);
  assert.match(restore, /pg_restore: код \$rc, ошибок \$errors/);
});

test('скрипт счётчиков только читает', () => {
  const body = counts.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').toLowerCase();
  assert.doesNotMatch(body, /\b(insert|update|delete|create|drop|alter|grant|revoke|truncate|commit)\b/);
  assert.match(body, /select/);
});

test('в документе описаны условия восстановления без перезаписи боевой базы', () => {
  assert.match(docs, /не восстанавливать всю базу поверх боевой/);
  assert.match(docs, /Файлы Storage/);
  assert.match(docs, /RPO/);
  assert.match(docs, /RTO/);
});

// ---- Функциональные проверки: скрипт отказывает до подключения к базе (база и age не нужны) ----
const VALID_RECIPIENT = 'age13yh90jec078ehylwv02dxzjpnw0qqjlwetjlxcay490xcrk9t5qs7j99v2';
function runDump(env) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kickstart-bk-test-'));
  const backupDir = path.join(tmp, 'backups');
  const r = spawnSync('bash', [path.join(ROOT, 'db/ops/backup-pg-dump.sh')], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: tmp, BACKUP_ENV_FILE: path.join(tmp, 'none.env'),
           SUPABASE_DB_URL: 'postgresql://nobody@127.0.0.1:1/none', BACKUP_DIR: backupDir, ...env },
  });
  const left = fs.existsSync(backupDir) ? fs.readdirSync(backupDir, { recursive: true }) : [];
  fs.rmSync(tmp, { recursive: true, force: true });
  return { ...r, left };
}

for (const v of ['1', '0', 'yes', '']) {
  test(`ALLOW_PLAIN=${JSON.stringify(v)} отклоняется до подключения, файлов не появляется`, () => {
    const r = runDump({ ALLOW_PLAIN: v, AGE_RECIPIENT: VALID_RECIPIENT });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /ALLOW_PLAIN не поддерживается/);
    assert.deepEqual(r.left, []);
  });
}

test('ALLOW_PLAIN в файле настроек тоже отклоняется', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kickstart-bk-env-'));
  const envFile = path.join(tmp, 'backup.env');
  fs.writeFileSync(envFile, `AGE_RECIPIENT='${VALID_RECIPIENT}'\nALLOW_PLAIN=1\n`, { mode: 0o600 });
  const r = spawnSync('bash', [path.join(ROOT, 'db/ops/backup-pg-dump.sh')], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp, BACKUP_ENV_FILE: envFile,
      SUPABASE_DB_URL: 'postgresql://nobody@127.0.0.1:1/none', BACKUP_DIR: path.join(tmp, 'b') } });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /ALLOW_PLAIN не поддерживается/);
});

test('без AGE_RECIPIENT копия не пишется', () => {
  const r = runDump({});
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /AGE_RECIPIENT не задан/);
  assert.deepEqual(r.left, []);
});

for (const bad of ['x', 'age1short', 'AGE1' + 'q'.repeat(58), VALID_RECIPIENT + 'q', 'age1' + 'b'.repeat(58)]) {
  test(`AGE_RECIPIENT не в формате age отклоняется: ${bad.slice(0, 12)}…`, () => {
    const r = runDump({ AGE_RECIPIENT: bad });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /не похож на публичный ключ age/);
  });
}

test('проверка восстановления отклоняет открытый .dump', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kickstart-rc-'));
  const f = path.join(tmp, 'kickstart-2026-01-01_0000.dump');
  fs.writeFileSync(f, 'x');
  const r = spawnSync('bash', [path.join(ROOT, 'db/ops/backup-restore-check.sh'), f], {
    encoding: 'utf8', env: { PATH: process.env.PATH, TEST_PG_URL: 'postgresql://postgres@localhost:5432' } });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /нужен зашифрованный дамп/);
});
