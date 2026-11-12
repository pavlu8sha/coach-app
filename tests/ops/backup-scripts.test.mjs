// Статические проверки скриптов резервного копирования (REL-01). Условия: db/ops/BACKUP_ACCEPTANCE.md.
// Подключения к базе нет: проверяем текст скриптов и синтаксис bash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('дамп пишется в custom-формате, без владельца, с шифрованием по умолчанию', () => {
  assert.match(dump, /--format=custom/);
  assert.match(dump, /--no-owner/);
  assert.match(dump, /AGE_RECIPIENT/);
  assert.match(dump, /ALLOW_PLAIN/);
  assert.match(dump, /die "AGE_RECIPIENT не задан/);
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

test('запись через временный файл и проверка pg_restore -l до переименования', () => {
  const tmpIdx = dump.indexOf('"$PG_RESTORE" -l "$tmp"');
  const mvIdx = dump.indexOf('mv "$tmp" "$base.dump"');
  assert.ok(tmpIdx > 0 && mvIdx > tmpIdx, 'pg_restore -l должен идти до mv');
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
