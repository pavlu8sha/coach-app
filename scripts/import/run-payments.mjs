// Импорт оплат (листы ОПЛАТЫ по месяцам) в Supabase.
// Использование:
//   node scripts/import/run-payments.mjs --registry реестр.csv месяц1.csv месяц2.csv ...           — только проверка
//   node scripts/import/run-payments.mjs --registry реестр.csv месяц1.csv ... --write             — записать
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
// Правила: subscriptions.amount_due = внесённая сумма; payments — по одной строке на внесённую сумму,
// paid_on = 1-е число месяца (даты платежа в выгрузке нет). Повторный запуск не дублирует платежи (по legacy_ref).
import fs from 'node:fs';
import path from 'node:path';
import { parseRegistry } from './registry.mjs';
import { parsePayMonth } from './payments.mjs';
import { PAY_NAME_ALIAS, PAY_GUESTS, IND_GROUP } from './payments-plan.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
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
if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }
if (problems.length) { console.error('Есть ошибки разбора — исправьте файлы и запустите снова.'); process.exit(1); }

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

// игроки и группы из базы (по ФИ и названию)
const dbPlayers = await rest('GET', `players?club_id=eq.${CLUB_ID}&select=id,full_name`);
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

// 1) абонементы: по одной строке на игрока и месяц
// одна строка абонемента на игрока и месяц: группа — из реестра, сумма — по всем строкам месяца
const subMap = new Map();
for (const r of rows) {
  const pid = idOf(r.name);
  const key = `${pid}|${r.month}`;
  const regGroup = regByName.get(canon(r.name))?.group_name;
  const gid = groupId.get(regGroup) ?? groupId.get(r.group);
  const cur = subMap.get(key) || { player_id: pid, group_id: gid, month: r.month, amount_due: 0 };
  cur.amount_due += r.paid;
  subMap.set(key, cur);
}
const subs = [...subMap.values()];
for (let i = 0; i < subs.length; i += 500) {
  await rest('POST', 'subscriptions?on_conflict=player_id,month', subs.slice(i, i + 500), 'resolution=merge-duplicates,return=minimal');
}

// 2) id абонементов для связки с платежами
const monthsSet = [...new Set(rows.map(r => r.month))];
const subRows = await rest('GET', `subscriptions?select=id,player_id,month&month=in.(${monthsSet.join(',')})`);
const subId = new Map(subRows.map(s => [`${s.player_id}|${s.month}`, s.id]));

// 3) платежи: только внесённые суммы, без дублей (по legacy_ref)
const existing = new Set((await rest('GET', 'payments?select=legacy_ref&legacy_ref=like.PAY_ID*')).map(x => x.legacy_ref));
const pays = rows.filter(r => r.paid > 0).map(r => {
  const ref = `PAY_ID ${r.month.slice(0, 7)} ${r.group} №${r.no} ${norm(r.name)}`;
  return { ref, row: {
    player_id: idOf(r.name), subscription_id: subId.get(`${idOf(r.name)}|${r.month}`),
    amount: r.paid, paid_on: r.month, method: null, recorded_by: null, legacy_ref: ref,
  } };
}).filter(p => !existing.has(p.ref)).map(p => p.row);
for (let i = 0; i < pays.length; i += 500) {
  await rest('POST', 'payments', pays.slice(i, i + 500), 'return=minimal');
}
console.log(`Записано: абонементов ${subs.length}, платежей ${pays.length} (пропущено уже существующих: ${rows.filter(r => r.paid > 0).length - pays.length}).`);
