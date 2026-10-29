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
import { IND_PRICE, parsePayBlock, parseSessionsSheet, replayJournal } from './individual.mjs';
import { buildIndividualPlan } from './individual-plan.mjs';
import { getAll } from './rest-all.mjs';

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const write = process.argv.includes('--write');
const regFile = arg('registry'), payDir = arg('pay-dir'), sessFile = arg('sessions'), jFile = arg('journal'), oldDir = arg('old-dir');
if (!regFile || !payDir || !sessFile || !jFile) { console.error('Укажите --registry, --pay-dir (папка PAY_ID), --sessions (ЗАНЯТИЯ), --journal (ОПЛАТЫ) и при необходимости --old-dir (старые IND_ID, занятия до сентября)'); process.exit(2); }

const reg = parseRegistry(fs.readFileSync(regFile, 'utf8'));
const names = reg.players.map(p => p.full_name);
// Записи и оплаты — из блока «Индивидуальные / Вратарские» в файлах оплат (лист месяца)
const payRows = fs.readdirSync(payDir).filter(n => n.endsWith('.csv')).sort()
  .flatMap(f => parsePayBlock(fs.readFileSync(path.join(payDir, f), 'utf8')));
const sessionsSheet = parseSessionsSheet(fs.readFileSync(sessFile, 'utf8'));
const journal = replayJournal(fs.readFileSync(jFile, 'utf8'), names);
// Занятия до сентября — из старой таблицы занятий (IND_ID): там история с 18.01, в листах приложения её нет
const oldFiles = oldDir
  ? fs.readdirSync(oldDir).filter(n => n.endsWith('.csv')).sort()
    .map(n => ({ name: n, text: fs.readFileSync(path.join(oldDir, n), 'utf8') }))
  : [];
const plan = buildIndividualPlan({ registryNames: names, payRows, sessionsSheet, journalBookings: journal.bookings, oldFiles });
const { sessions, bookings, guests, problems } = plan;
const entries = bookings.length;
const paid = bookings.filter(p => p.paid).length;
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
const dbPlayers = await getAll(rest, `players?club_id=eq.${CLUB_ID}&select=id,external_id,full_name`);
const byName = new Map(dbPlayers.map(p => [p.full_name, p.id]));
const absent = [...new Set(bookings.map(p => p.name).filter(n => !byName.has(n)))];
if (absent.length) { console.error('Игроки не найдены в базе (сначала реестр и гости): ' + absent.join(', ')); process.exit(1); }

// 3) занятия
await rest('POST', 'individual_sessions?on_conflict=club_id,external_id', sessions.map(s => ({
  club_id: CLUB_ID, external_id: s.external_id, starts_at: s.starts_at, topic: s.topic, goalkeepers: s.external_id.endsWith('-GK'),
})), MERGE);
const dbS = await getAll(rest, `individual_sessions?club_id=eq.${CLUB_ID}&select=id,external_id`);
const sid = new Map(dbS.map(s => [s.external_id, s.id]));

// 4) записи
const rowsB = sessions.flatMap(s => s.people.map(p => ({
  session_id: sid.get(s.external_id), player_id: byName.get(p.name), amount: IND_PRICE, paid: p.paid,
})));
for (let i = 0; i < rowsB.length; i += 500) {
  await rest('POST', 'individual_bookings?on_conflict=session_id,player_id', rowsB.slice(i, i + 500), MERGE);
}
console.log(`Записано: занятий ${sessions.length}, записей ${rowsB.length}, гостей ${guestRows.length}.`);
