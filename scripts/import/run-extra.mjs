// Импорт дополнительных тренировок (листы EXTRA_ID) в Supabase. Нужна миграция 0035.
// Использование:
//   node scripts/import/run-extra.mjs --registry РЕЕСТР.csv --dir ПАПКА_EXTRA_ID [--prices ДОПОЛНИТЕЛЬНЫЕ_ТРЕНИРОВКИ.csv] [--journal ДОПОЛНИТЕЛЬНЫЕ_ОПЛАТЫ.csv] [--year 2026] [--amount 20]   — проверка
//   то же + --write — записать
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
// Повторный запуск не дублирует: занятие — по (клуб, дата), запись — по (занятие, игрок). Уже оплаченные записи не перезаписываются.
import fs from 'node:fs';
import path from 'node:path';
import { parseRegistry } from './registry.mjs';
import { buildExtraPlan, parseExtraPrices, replayExtraJournal } from './extra.mjs';
import { getAll } from './rest-all.mjs';

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const write = process.argv.includes('--write');
const regFile = arg('registry'), dir = arg('dir');
if (!regFile || !dir) { console.error('Укажите --registry и --dir (папка EXTRA_ID из выгрузки); при необходимости --prices, --journal, --year, --amount'); process.exit(2); }
const read = f => fs.readFileSync(f, 'utf8');

const names = parseRegistry(read(regFile)).players.map(p => p.full_name);
const sheets = fs.readdirSync(dir).filter(n => n.endsWith('.csv')).sort().map(n => ({ name: n.replace(/\.csv$/, ''), text: read(path.join(dir, n)) }));
const plan = buildExtraPlan({
  registryNames: names, sheets,
  prices: arg('prices') ? parseExtraPrices(read(arg('prices'))) : new Map(),
  journal: arg('journal') ? replayExtraJournal(read(arg('journal'))) : new Map(),
  year: Number(arg('year')) || new Date().getFullYear(), defaultAmount: Number(arg('amount')) || 0,
});
const { sessions, problems, former } = plan;
const entries = sessions.reduce((n, s) => n + s.people.length, 0);
const paid = sessions.reduce((n, s) => n + s.people.filter(p => p.paid).length, 0);
console.log(`Тренировок ${sessions.length} (${sessions.map(s => s.starts_on).sort()[0] ?? '—'} … ${sessions.map(s => s.starts_on).sort().pop() ?? '—'}), записей ${entries}, оплачено ${paid}, не оплачено ${entries - paid}`);
console.log(`Бывшие игроки (будут добавлены неактивными): ${former.length}${former.length ? ' — ' + former.map(f => f.full_name).join('; ') : ''}`);
console.log(`Без суммы: ${sessions.filter(s => !s.amount).length}. Проблем: ${problems.length}`);
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

// бывшие игроки, которых нет в реестре, — неактивные игроки без группы (как бывшие дети в посещаемости)
if (former.length) await rest('POST', 'players?on_conflict=club_id,external_id', former.map(f => ({
  club_id: CLUB_ID, external_id: f.external_id, full_name: f.full_name, status: 'inactive',
})), MERGE);
const dbPlayers = await getAll(rest, `players?club_id=eq.${CLUB_ID}&select=id,full_name`);
const byName = new Map(dbPlayers.map(p => [p.full_name, p.id]));
const absent = [...new Set(sessions.flatMap(s => s.people.map(p => p.name)).filter(n => !byName.has(n)))];
if (absent.length) { console.error('Игроки не найдены в базе (сначала реестр): ' + absent.join(', ')); process.exit(1); }

await rest('POST', 'extra_sessions?on_conflict=club_id,starts_on', sessions.map(s => ({ club_id: CLUB_ID, starts_on: s.starts_on, amount: s.amount })), MERGE);
const dbS = await getAll(rest, `extra_sessions?club_id=eq.${CLUB_ID}&select=id,starts_on`);
const sid = new Map(dbS.map(s => [s.starts_on, s.id]));
const rowsB = sessions.flatMap(s => s.people.map(p => ({
  session_id: sid.get(s.starts_on), player_id: byName.get(p.name), paid: p.paid, paid_amount: p.paid ? (p.paid_amount ?? s.amount) : null, method: p.method,
})));
for (let i = 0; i < rowsB.length; i += 500) await rest('POST', 'extra_bookings?on_conflict=session_id,player_id', rowsB.slice(i, i + 500), MERGE);
console.log(`Записано: тренировок ${sessions.length}, записей ${rowsB.length}.`);
