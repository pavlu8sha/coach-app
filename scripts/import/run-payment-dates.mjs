// Только чтение: настоящие даты оплат абонементов из журнала «АБОНЕМЕНТЫ» (ничего не пишет в базу).
//   node scripts/import/run-payment-dates.mjs --journal АБОНЕМЕНТЫ.csv [--sql замена-дат.sql]
// Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID (как у остальных скриптов импорта): платежи читаются из базы.
// С --sql пишет файл с SQL для Supabase SQL Editor (транзакция, по умолчанию rollback); сама ничего не меняет.
import fs from 'node:fs';
import { getAll } from './rest-all.mjs';
import { parseJournalDated, planPaymentDates, datesSql } from './payment-dates.mjs';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
const jFile = opt('--journal'), sqlFile = opt('--sql');
if (!jFile) { console.error('Укажите --journal АБОНЕМЕНТЫ.csv'); process.exit(2); }
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) { console.error('Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID'); process.exit(2); }
const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
async function rest(method, p) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method, headers });
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${await res.text()}`);
  return res.json();
}

const journal = parseJournalDated(fs.readFileSync(jFile, 'utf8'));
const players = await getAll(rest, `players?club_id=eq.${CLUB_ID}&select=id,external_id`);
const extOf = new Map(players.map(p => [p.id, p.external_id]));
const rows = await getAll(rest, 'payments?select=id,player_id,subscription_id,amount,legacy_ref&legacy_ref=like.PAY_ID*');
const db = rows.map(r => ({ ...r, player_ext: extOf.get(r.player_id), month: `${(/^PAY_ID (\d{4}-\d{2})/.exec(r.legacy_ref) ?? [])[1]}-01` }))
  .filter(r => r.player_ext && !r.month.startsWith('undefined'));

const { ops, skipped } = planPaymentDates({ journal, db });
const groups = new Set(db.map(r => `${r.player_ext}|${r.month}`)).size;
const nIns = ops.reduce((a, o) => a + o.inserts.length, 0), nDel = ops.reduce((a, o) => a + o.deleteIds.length, 0);
console.log(`Записей журнала (игрок × месяц): ${journal.size}; платежей импорта: ${db.length} (игрок × месяц: ${groups})`);
console.log(`Можно заменить настоящими датами: ${ops.length} из ${groups}; будет обновлено платежей ${ops.length}, добавлено ${nIns}, удалено коррекций ${nDel}`);
const reasons = new Map();
for (const s of skipped) { const k = s.reason.replace(/«[^»]*»/, '«…»').replace(/\s*\(строка журнала \d+\)/, ''); reasons.set(k, (reasons.get(k) ?? 0) + 1); }
console.log(`Остаются как есть: ${skipped.length}` + (reasons.size ? ' (' + [...reasons].map(([k, n]) => `${k}: ${n}`).join('; ') + ')' : ''));
for (const s of skipped.filter(x => x.reason !== 'нет записей журнала')) console.log('  ' + JSON.stringify(s));
if (sqlFile) {
  fs.writeFileSync(sqlFile, datesSql(ops), 'utf8');
  console.log(`SQL записан в ${sqlFile} (в конце rollback; в базу скрипт ничего не писал).`);
} else {
  console.log('Добавьте --sql файл.sql, чтобы получить SQL для замены. В базу скрипт ничего не пишет.');
}
