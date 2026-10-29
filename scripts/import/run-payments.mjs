// Импорт оплат (листы ОПЛАТЫ по месяцам) в Supabase.
// Использование:
//   node scripts/import/run-payments.mjs --registry реестр.csv месяц1.csv месяц2.csv ...           — только проверка
//   node scripts/import/run-payments.mjs --registry реестр.csv месяц1.csv ... --write             — записать
//   Если заданы SUPABASE_URL, ключ и CLUB_ID, проверка (без записи) читает базу и ищет возможные дубли из-за сдвига номеров строк в листе (ключ платежа содержит номер строки);
//   при находках код выхода 1 и запись остановлена, пока их не просмотрели и не добавили --accept-possible-duplicates.
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
// Правила: subscriptions.amount_due = внесённая сумма; payments — по одной строке на внесённую сумму,
// paid_on = 1-е число месяца (даты платежа в выгрузке нет). Повторный запуск не дублирует платежи (по legacy_ref).
import fs from 'node:fs';
import path from 'node:path';
import { parseRegistry } from './registry.mjs';
import { parsePayMonth } from './payments.mjs';
import { PAY_NAME_ALIAS, PAY_GUESTS, IND_GROUP } from './payments-plan.mjs';
import { getAll } from './rest-all.mjs';
import { possibleDuplicates } from './payments-guard.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const acceptDup = args.includes('--accept-possible-duplicates');
const regIdx = args.indexOf('--registry');
if (regIdx < 0 || !args[regIdx + 1]) { console.error('Укажите --registry реестр.csv'); process.exit(2); }
const regFile = args[regIdx + 1];
const files = args.filter((a, i) => !a.startsWith('--') && i !== regIdx + 1);
if (!files.length) { console.error('Укажите файлы месяцев'); process.exit(2); }

const reg = parseRegistry(fs.readFileSync(regFile, 'utf8'));
if (reg.problems.length) { console.error('Сначала исправьте реестр: проблемы в строках ' + reg.problems.length); process.exit(1); }
const groupNames = new Set(reg.groups.map(g => g.name));
const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const canon = s => { const k = norm(s); return PAY_NAME_ALIAS[k] ?? k; };

const months = files.map(f => parsePayMonth(fs.readFileSync(f, 'utf8'), path.basename(f), groupNames));
const all = months.flatMap(m => m.rows);
const problems = months.flatMap(m => m.problems);
const regByName = new Map(reg.players.map(p => [norm(p.full_name), p]));
const unmatched = [...new Set(all.filter(r => !PAY_GUESTS.has(norm(r.name)) && !regByName.has(canon(r.name))).map(r => `${r.month.slice(0, 7)} ${r.name}`))];
for (const m of months) console.log(`${path.basename(m.rows[0]?.month ? files[months.indexOf(m)] : files[months.indexOf(m)])}: строк ${m.rows.length}, оплачено ${m.rows.filter(r => r.paid > 0).length}, сумма ${m.rows.reduce((a, r) => a + r.paid, 0)} ₾`);
console.log(`Проблем разбора: ${problems.length}`);
for (const p of problems) console.log(`  строка ${p.line}: ${p.name} — ${p.error}`);
console.log(`Не найдены в реестре (не запишутся): ${unmatched.length}`);
for (const u of unmatched) console.log(`  ${u}`);
if (write && problems.length) { console.error('Есть ошибки разбора — исправьте файлы и запустите снова.'); process.exit(1); }

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) {
  if (write) { console.error('Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID'); process.exit(2); }
  console.log('Проверка без записи (базу не читали: нет SUPABASE_URL, ключа или CLUB_ID). Для записи добавьте --write.'); process.exit(0);
}
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

// игроки и группы из базы (по ФИ и названию)
const dbPlayers = await getAll(rest, `players?club_id=eq.${CLUB_ID}&select=id,full_name`);
const playerId = new Map(dbPlayers.map(p => [norm(p.full_name), p.id]));
const idOf = name => playerId.get(canon(name));
const dbGroups = await rest('GET', `groups?club_id=eq.${CLUB_ID}&select=id,name`);
const groupId = new Map(dbGroups.map(g => [g.name, g.id]));

// Индивидуальные / вратарские тренировки в абонементы не пишем: у них нет месяца-абонемента, их импорт — отдельным шагом с листами IND_ID
const indCount = all.filter(r => r.group === IND_GROUP).length;
const rows = all.filter(r => r.group !== IND_GROUP && !PAY_GUESTS.has(norm(r.name)) && playerId.has(canon(r.name)) && groupId.has(r.group));
console.log(`Индивидуальные строки (не пишутся в этом шаге): ${indCount}`);
const missingGroups = [...new Set(all.map(r => r.group).filter(g => !groupId.has(g)))];
if (missingGroups.length) { console.error('Группы не найдены в базе, сначала импортируйте реестр: ' + missingGroups.join(', ')); process.exit(1); }

// Платежи, которые импорт запишет, и защита от дублей при сдвиге номеров строк (до любой записи)
const dbPay = await getAll(rest, 'payments?select=id,player_id,amount,paid_on,legacy_ref&legacy_ref=like.PAY_ID*');
const existing = new Set(dbPay.map(x => x.legacy_ref));
const candidates = rows.filter(r => r.paid > 0).map(r => ({ ref: `PAY_ID ${r.month.slice(0, 7)} ${r.group} №${r.no} ${norm(r.name)}`, player_id: idOf(r.name), amount: r.paid, paid_on: r.month }));
const fresh = candidates.filter(c => !existing.has(c.ref));
const dups = possibleDuplicates(fresh, dbPay);
console.log(`Новых платежей к записи: ${fresh.length} на ${Math.round(fresh.reduce((a, c) => a + c.amount, 0) * 100) / 100} ₾ (уже в базе: ${candidates.length - fresh.length}).`);
if (dups.length) {
  console.log(`ВНИМАНИЕ: возможные дубли (${dups.length}): платёж «новый», но в базе есть платёж того же игрока, месяца и суммы с другим ключом (сдвиг номеров строк в листе?):`);
  for (const d of dups.slice(0, 40)) console.log(`  ${d.ref} | в базе: ${d.baseRefs.join('; ')}`);
  if (dups.length > 40) console.log(`  … ещё ${dups.length - 40}`);
  if (!acceptDup) { console.error('Запись оплат остановлена: просмотрите находки; если это разные платежи, добавьте --accept-possible-duplicates.'); process.exit(1); }
}
if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }

// 1) абонементы: по одной строке на игрока и месяц
// одна строка абонемента на игрока и месяц: группа — из листа оплат, сумма — по всем строкам месяца
const subMap = new Map();
const groupsByKey = new Map();
for (const r of rows) {
  const pid = idOf(r.name);
  const key = `${pid}|${r.month}`;
  const gid = groupId.get(r.group);
  const cur = subMap.get(key) || { player_id: pid, group_id: gid, month: r.month, amount_due: 0 };
  cur.amount_due += r.paid;
  subMap.set(key, cur);
  const groups = groupsByKey.get(key) ?? new Set();
  groups.add(r.group);
  groupsByKey.set(key, groups);
}
const ambiguous = [...groupsByKey].filter(([, g]) => g.size > 1);
// несколько групп в одном месяце: если текущая группа реестра среди них, берём её (как до этой правки), иначе группу первой строки
const regGroupById = new Map(reg.players.map(p => [playerId.get(norm(p.full_name)), p.group_name]));
for (const [key, g] of ambiguous) {
  const regGroup = regGroupById.get(key.split('|')[0]);
  if (g.has(regGroup)) subMap.get(key).group_id = groupId.get(regGroup);
}
if (ambiguous.length) console.log(`Внимание: несколько групп в одном месяце у ${ambiguous.length} абонементов; взята текущая группа реестра, если она среди них, иначе группа первой строки. Проверьте вручную.`);
const subs = [...subMap.values()];
for (let i = 0; i < subs.length; i += 500) {
  await rest('POST', 'subscriptions?on_conflict=player_id,month', subs.slice(i, i + 500), 'resolution=merge-duplicates,return=minimal');
}

// 2) id абонементов для связки с платежами
const monthsSet = [...new Set(rows.map(r => r.month))];
const subRows = await getAll(rest, `subscriptions?select=id,player_id,month&month=in.(${monthsSet.join(',')})`);
const subId = new Map(subRows.map(s => [`${s.player_id}|${s.month}`, s.id]));

// 3) платежи: только внесённые суммы, без дублей (по legacy_ref)
const pays = fresh.map(c => ({
  player_id: c.player_id, subscription_id: subId.get(`${c.player_id}|${c.paid_on}`),
  amount: c.amount, paid_on: c.paid_on, method: null, recorded_by: null, legacy_ref: c.ref,
}));
for (let i = 0; i < pays.length; i += 500) {
  await rest('POST', 'payments', pays.slice(i, i + 500), 'return=minimal');
}
console.log(`Записано: абонементов ${subs.length}, платежей ${pays.length} (пропущено уже существующих: ${candidates.length - pays.length}).`);
