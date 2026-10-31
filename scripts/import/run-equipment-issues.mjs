// Дописывает в базу выдачу экипировки из листа «ВЫДАЧА» старого приложения. По умолчанию только читает и печатает отчёт.
//   node scripts/import/run-equipment-issues.mjs --file ВЫДАЧА.csv [--write]
// Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Уже выданное в базе не меняется.
import fs from 'node:fs';
import { getAll } from './rest-all.mjs';
import { parseIssues, planIssues } from './equipment-issues.mjs';

const args = process.argv.slice(2);
const fi = args.indexOf('--file'), file = fi < 0 ? null : args[fi + 1], write = args.includes('--write');
if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { console.error('--file должен указывать на файл ВЫДАЧА.csv (не на папку)'); process.exit(2); }
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLUB_ID) { console.error('Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID'); process.exit(2); }
const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
async function rest(method, p, body, prefer = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

const issues = parseIssues(fs.readFileSync(file, 'utf8'));
const orderRows = await getAll(rest, `equipment_orders?club_id=eq.${CLUB_ID}&select=id,external_ord_id`);
const lineRows = await getAll(rest, 'equipment_order_lines?select=order_id,kit');
const orders = new Map(orderRows.filter(o => o.external_ord_id).map(o => [o.external_ord_id, { id: o.id, kits: new Set() }]));
const byId = new Map([...orders.values()].map(o => [o.id, o]));
for (const l of lineRows) byId.get(l.order_id)?.kits.add(l.kit);
const have = new Set((await getAll(rest, 'equipment_issues?select=order_id,kit')).map(r => `${r.order_id}|${r.kit}`));
const { add, skipped } = planIssues({ issues, orders, have });

console.log(`Строк ВЫДАЧИ: ${issues.length}; в базе уже выдано вещей: ${have.size}`);
console.log(`Заказов нет в базе: ${skipped.noOrder.size} ${[...skipped.noOrder].slice(0, 10).join(' ')}`);
console.log(`Вещи не из заказа: ${skipped.noKit.length}` + (skipped.noKit.length ? ' ' + JSON.stringify(skipped.noKit.slice(0, 10)) : ''));
console.log(`Непонятная дата выдачи (поставится сегодняшняя): ${skipped.badDate.length}` + (skipped.badDate.length ? ' ' + JSON.stringify(skipped.badDate.slice(0, 10)) : ''));
const byOrd = new Set(add.map(a => a.ord));
console.log(`Будет добавлено выдач: ${add.length} вещей в ${byOrd.size} заказах.`);
if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }
for (let i = 0; i < add.length; i += 500) {
  const today = new Date().toISOString().slice(0, 10);
  const chunk = add.slice(i, i + 500).map(({ ord, ...r }) => ({ ...r, issued_on: r.issued_on ?? today }));
  await rest('POST', 'equipment_issues?on_conflict=order_id,kit', chunk, 'resolution=ignore-duplicates,return=minimal');
}
console.log(`Записано: ${add.length} выдач.`);
