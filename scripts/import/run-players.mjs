// Импорт реестра игроков и групп в Supabase.
// Использование:
//   node scripts/import/run-players.mjs registry.csv            — только проверка, ничего не пишет
//   node scripts/import/run-players.mjs registry.csv --write    — записать в базу
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY (сервисный ключ, только для импорта), CLUB_ID.
// Ключ в репозиторий и в чат не класть.
import fs from 'node:fs';
import { parseRegistry } from './registry.mjs';

const [file, flag] = process.argv.slice(2);
if (!file) { console.error('Укажите CSV реестра'); process.exit(2); }
const reg = parseRegistry(fs.readFileSync(file, 'utf8'));
const active = reg.players.filter(p => p.status === 'active').length;
console.log(`Групп: ${reg.groups.length}, игроков: ${reg.players.length} (активных ${active}), проблем: ${reg.problems.length}`);
for (const p of reg.problems) console.log(`  строка ${p.line}: ${p.error} ${p.id || p.name || ''}`);
if (flag !== '--write') { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }
if (reg.problems.length) { console.error('Есть проблемы в строках — исправьте таблицу и запустите снова.'); process.exit(1); }

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) { console.error('Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID'); process.exit(2); }
const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

async function rest(method, path, body, prefer = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text(); // return=minimal отдаёт пустое тело
  return text ? JSON.parse(text) : null;
}

// 1) группы (upsert по club_id + name)
await rest('POST', 'groups?on_conflict=club_id,name',
  reg.groups.map(g => ({ club_id: CLUB_ID, name: g.name, location: g.location })),
  'resolution=merge-duplicates,return=minimal');
const groups = await rest('GET', `groups?club_id=eq.${CLUB_ID}&select=id,name`);
const groupId = new Map(groups.map(g => [g.name, g.id]));

// 2) игроки (upsert по club_id + external_id), пачками по 500
const rows = reg.players.map(p => ({
  club_id: CLUB_ID, external_id: p.external_id, full_name: p.full_name,
  group_id: p.group_name ? groupId.get(p.group_name) : null,
  status: p.status, starts_on: p.starts_on, ends_on: p.ends_on, extras: p.extras,
}));
for (let i = 0; i < rows.length; i += 500) {
  await rest('POST', 'players?on_conflict=club_id,external_id', rows.slice(i, i + 500), 'resolution=merge-duplicates,return=minimal');
}
console.log(`Записано: групп ${reg.groups.length}, игроков ${rows.length}.`);
