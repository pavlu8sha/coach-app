// Импорт индивидуальных тренировок (листы IND_ID) в Supabase. Нужна миграция 0008.
// Использование:
//   node scripts/import/run-individual.mjs --registry РЕЕСТР.csv --dir ПАПКА_IND_ID        — проверка
//   то же + --write — записать
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
// Гости записываются в players с external_id GUEST-… и статусом inactive. Повторный запуск не дублирует.
import fs from 'node:fs';
import path from 'node:path';
import { parseRegistry } from './registry.mjs';
import { parseIndividualFile, IND_PRICE } from './individual.mjs';

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const write = process.argv.includes('--write');
const regFile = arg('registry'), dir = arg('dir');
if (!regFile || !dir) { console.error('Укажите --registry и --dir (папка IND_ID)'); process.exit(2); }

const reg = parseRegistry(fs.readFileSync(regFile, 'utf8'));
const names = reg.players.map(p => p.full_name);
const sessions = [], problems = [];
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.csv')).sort()) {
  const r = parseIndividualFile(fs.readFileSync(path.join(dir, f), 'utf8'), f, names);
  sessions.push(...r.sessions); problems.push(...r.problems);
}
const entries = sessions.reduce((a, s) => a + s.people.length, 0);
const paid = sessions.reduce((a, s) => a + s.people.filter(p => p.paid).length, 0);
const guests = [...new Set(sessions.flatMap(s => s.people.filter(p => p.guest).map(p => p.name)))];
console.log(`Занятий ${sessions.length} (вратарских ${sessions.filter(s => s.external_id.endsWith('GK')).length}), записей ${entries}, оплачено ${paid}, не оплачено ${entries - paid}`);
console.log(`Гости: ${guests.join(', ')}`);
console.log(`Проблем: ${problems.length}`);
for (const p of problems) console.log(`  ${p.file}: ${p.error}`);
if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }
if (problems.length) { console.error('Есть проблемы разбора — запись остановлена.'); process.exit(1); }

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) { console.error('Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID'); process.exit(2); }
const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
async function rest(method, p, body, prefer = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, {
    method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const MERGE = 'resolution=merge-duplicates,return=minimal';

// 1) гости — как игроки без группы
const guestRows = [...new Map(sessions.flatMap(s => s.people.filter(p => p.guest)).map(p => [p.external_id, p])).values()];
if (guestRows.length) await rest('POST', 'players?on_conflict=club_id,external_id', guestRows.map(g => ({
  club_id: CLUB_ID, external_id: g.external_id, full_name: g.name, status: 'inactive',
})), MERGE);

// 2) игроки базы: реестр (KS-…) и гости (GUEST-…)
const dbPlayers = await rest('GET', `players?club_id=eq.${CLUB_ID}&select=id,external_id,full_name`);
const byName = new Map(dbPlayers.map(p => [p.full_name, p.id]));
const absent = [...new Set(sessions.flatMap(s => s.people.map(p => p.name)).filter(n => !byName.has(n)))];
if (absent.length) { console.error('Игроки не найдены в базе (сначала реестр и гости): ' + absent.join(', ')); process.exit(1); }

// 3) занятия
await rest('POST', 'individual_sessions?on_conflict=club_id,external_id', sessions.map(s => ({
  club_id: CLUB_ID, external_id: s.external_id, starts_at: s.starts_at, topic: s.topic,
})), MERGE);
const dbS = await rest('GET', `individual_sessions?club_id=eq.${CLUB_ID}&select=id,external_id`);
const sid = new Map(dbS.map(s => [s.external_id, s.id]));

// 4) записи
const bookings = sessions.flatMap(s => s.people.map(p => ({
  session_id: sid.get(s.external_id), player_id: byName.get(p.name), amount: IND_PRICE, paid: p.paid,
})));
for (let i = 0; i < bookings.length; i += 500) {
  await rest('POST', 'individual_bookings?on_conflict=session_id,player_id', bookings.slice(i, i + 500), MERGE);
}
console.log(`Записано: занятий ${sessions.length}, записей ${bookings.length}, гостей ${guestRows.length}.`);
