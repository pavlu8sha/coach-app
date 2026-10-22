// Импорт индивидуальных тренировок (листы IND_ID) в Supabase. Нужна миграция 0008.
// Источник: блок «Индивидуальные / Вратарские» в файлах оплат; время и тема — из листов приложения.
// Использование:
//   node scripts/import/run-individual.mjs --registry РЕЕСТР.csv --pay-dir ПАПКА_PAY_ID --sessions ИНДИВИДУАЛЬНЫЕ_ЗАНЯТИЯ.csv --journal ИНДИВИДУАЛЬНЫЕ_ОПЛАТЫ.csv   — проверка
//   то же + --write — записать
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
// Гости записываются в players с external_id GUEST-… и статусом inactive. Повторный запуск не дублирует.
import fs from 'node:fs';
import path from 'node:path';
import { parseRegistry } from './registry.mjs';
import { IND_PRICE, GUESTS, parsePayBlock, parseSessionsSheet, replayJournal, parseSessionKey, guestExt } from './individual.mjs';
import { resolveName } from './events-plan.mjs';

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const write = process.argv.includes('--write');
const regFile = arg('registry'), payDir = arg('pay-dir'), sessFile = arg('sessions'), jFile = arg('journal');
if (!regFile || !payDir || !sessFile || !jFile) { console.error('Укажите --registry, --pay-dir (папка PAY_ID), --sessions (ЗАНЯТИЯ), --journal (ОПЛАТЫ)'); process.exit(2); }

const reg = parseRegistry(fs.readFileSync(regFile, 'utf8'));
const names = reg.players.map(p => p.full_name);
// Записи и оплаты — из блока «Индивидуальные / Вратарские» в файлах оплат (лист месяца)
const problems = [];
const payRows = fs.readdirSync(payDir).filter(n => n.endsWith('.csv')).sort()
  .flatMap(f => parsePayBlock(fs.readFileSync(path.join(payDir, f), 'utf8')));
// Время занятия — из листа ЗАНЯТИЯ и из ID журнала (дата и время в ключе)
const times = new Map();
for (const s of parseSessionsSheet(fs.readFileSync(sessFile, 'utf8'))) times.set(s.key.slice(0, 10) + (s.goalkeepers ? ' gk' : ''), s);
const journal = replayJournal(fs.readFileSync(jFile, 'utf8'), names);
for (const b of journal.bookings) { const k = b.key.slice(0, 10) + (b.key.endsWith(' gk') ? ' gk' : ''); if (!times.has(k)) times.set(k, parseSessionKey(b.key)); }
const topics = new Map(parseSessionsSheet(fs.readFileSync(sessFile, 'utf8')).map(s => [s.key.slice(0, 10) + (s.goalkeepers ? ' gk' : ''), s.topic]));

// Время занятий, которых нет в листах приложения, — подтверждено тренером
const MANUAL_TIMES = {
  '2026-09-06': '19:00', '2026-09-12': '18:30', '2026-09-13': '18:00', '2026-09-13 gk': '19:00',
  '2026-09-19': '19:00', '2026-09-20': '18:00', '2026-09-20 gk': '19:00', '2026-09-26': '19:00',
  '2026-09-27': '18:00', '2026-09-27 gk': '19:00', '2026-10-31': '19:00',
};
const sessMap = new Map();
for (const r of payRows) {
  const k = r.date + (r.gk ? ' gk' : '');
  const info = times.get(k) ?? (MANUAL_TIMES[k] ? { starts_at: `${r.date}T${MANUAL_TIMES[k]}:00` } : null);
  if (!info) problems.push({ error: `нет времени занятия ${k}` });
  const sid = `IND-${r.date.replace(/-/g, '-')}${r.gk ? '-GK' : ''}`;
  if (!sessMap.has(sid)) sessMap.set(sid, { external_id: sid, starts_at: info ? info.starts_at : null, topic: topics.get(k) ?? null, people: new Map() });
  const sess = sessMap.get(sid);
  const g = GUESTS[r.name.toLowerCase()];
  const pname = g ?? resolveName(r.name, names)?.name;
  if (!pname) { problems.push({ error: `имя не найдено в реестре: ${r.name}` }); continue; }
  const cur = sess.people.get(pname);
  const guest = !!g;
  sess.people.set(pname, { name: pname, guest, external_id: guest ? guestExt(pname) : null, paid: (cur?.paid ?? false) || r.paid });
}
const sessions = [...sessMap.values()].map(s => ({ ...s, people: [...s.people.values()] }));
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
// (гости из файла оплат)
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
