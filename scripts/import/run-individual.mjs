// Импорт индивидуальных тренировок (листы IND_ID) в Supabase. Нужна миграция 0008.
// Источник: листы приложения (AdminApp), не старые файлы IND_ID.
// Использование:
//   node scripts/import/run-individual.mjs --registry РЕЕСТР.csv --sessions ИНДИВИДУАЛЬНЫЕ_ЗАНЯТИЯ.csv --journal ИНДИВИДУАЛЬНЫЕ_ОПЛАТЫ.csv   — проверка
//   то же + --write — записать
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
// Гости записываются в players с external_id GUEST-… и статусом inactive. Повторный запуск не дублирует.
import fs from 'node:fs';
import path from 'node:path';
import { parseRegistry } from './registry.mjs';
import { IND_PRICE, parseSessionsSheet, replayJournal, parseSessionKey } from './individual.mjs';

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const write = process.argv.includes('--write');
const regFile = arg('registry'), sessFile = arg('sessions'), jFile = arg('journal');
if (!regFile || !sessFile || !jFile) { console.error('Укажите --registry, --sessions, --journal'); process.exit(2); }

const reg = parseRegistry(fs.readFileSync(regFile, 'utf8'));
const names = reg.players.map(p => p.full_name);
const listed = parseSessionsSheet(fs.readFileSync(sessFile, 'utf8'));
const journal = replayJournal(fs.readFileSync(jFile, 'utf8'), names);
const problems = [...journal.problems];
// занятия: из листа ЗАНЯТИЯ и те, что есть только в журнале (старые, без строки в листе)
const sessMap = new Map(listed.map(s => [s.key, { ...s, people: [] }]));
for (const b of journal.bookings) {
  if (!sessMap.has(b.key)) { const info = parseSessionKey(b.key); if (!info) { problems.push({ error: 'занятие не разобрано: ' + b.key }); continue; } sessMap.set(b.key, { ...info, topic: null, people: [] }); }
  sessMap.get(b.key).people.push(b);
}
const sessions = [...sessMap.values()];
const bookings = sessions.flatMap(s => s.people);
const entries = bookings.length;
const paid = bookings.filter(p => p.paid).length;
const guests = [...new Set(bookings.filter(p => p.guest).map(p => p.name))];
console.log(`Занятий ${sessions.length} (вратарских ${sessions.filter(s => s.external_id.endsWith('GK')).length}), записей ${entries}, оплачено ${paid}, не оплачено ${entries - paid}`);
console.log(`Гости: ${guests.join(', ')}`);
console.log(`Проблем: ${problems.length}`);
for (const p of problems) console.log(`  ${p.error}`);
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
const guestRows = [...new Map(bookings.filter(p => p.guest).map(p => [p.external_id, p])).values()];
if (guestRows.length) await rest('POST', 'players?on_conflict=club_id,external_id', guestRows.map(g => ({
  club_id: CLUB_ID, external_id: g.external_id, full_name: g.name, status: 'inactive',
})), MERGE);

// 2) игроки базы: реестр (KS-…) и гости (GUEST-…)
const dbPlayers = await rest('GET', `players?club_id=eq.${CLUB_ID}&select=id,external_id,full_name`);
const byName = new Map(dbPlayers.map(p => [p.full_name, p.id]));
const absent = [...new Set(bookings.map(p => p.name).filter(n => !byName.has(n)))];
if (absent.length) { console.error('Игроки не найдены в базе (сначала реестр и гости): ' + absent.join(', ')); process.exit(1); }

// 3) занятия
await rest('POST', 'individual_sessions?on_conflict=club_id,external_id', sessions.map(s => ({
  club_id: CLUB_ID, external_id: s.external_id, starts_at: s.starts_at, topic: s.topic,
})), MERGE);
const dbS = await rest('GET', `individual_sessions?club_id=eq.${CLUB_ID}&select=id,external_id`);
const sid = new Map(dbS.map(s => [s.external_id, s.id]));

// 4) записи
const rowsB = sessions.flatMap(s => s.people.map(p => ({
  session_id: sid.get(s.external_id), player_id: byName.get(p.name), amount: IND_PRICE, paid: p.paid,
})));
for (let i = 0; i < rowsB.length; i += 500) {
  await rest('POST', 'individual_bookings?on_conflict=session_id,player_id', rowsB.slice(i, i + 500), MERGE);
}
console.log(`Записано: занятий ${sessions.length}, записей ${rowsB.length}, гостей ${guestRows.length}.`);
