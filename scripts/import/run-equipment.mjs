// Импорт экипировки (каталог и заказы сезона) в Supabase.
// Использование:
//   node scripts/import/run-equipment.mjs КАТАЛОГ.csv СЕЗОН.csv            — только проверка
//   node scripts/import/run-equipment.mjs КАТАЛОГ.csv СЕЗОН.csv --write    — записать
//   --registry РЕЕСТР.csv   — проверка заказов (equipment-guard): ID заказа и игрока, ФИ заказа против реестра и, если заданы SUPABASE_URL/ключ/CLUB_ID,
//                             сверка с базой по ID заказа (количество, суммы, игрок). Ошибки останавливают запись; предупреждения — до --accept-warnings.
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID. Ключ в репозиторий и в чат не класть.
// Правила: сумма заказа и оплачено — из листа (с учётом скидки на полный набор); позиции — цена из каталога.
// Дата каталога (valid_from) — начало сезона 2026-08-01. Заказы без даты пишутся с пустой датой (миграция 0006).
import fs from 'node:fs';
import path from 'node:path';
import { parseCatalog, parseSeason } from './equipment.mjs';
import { parseRegistry } from './registry.mjs';
import { guardEquipment } from './equipment-guard.mjs';
import { getAll } from './rest-all.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const acceptWarnings = args.includes('--accept-warnings');
const ri = args.indexOf('--registry');
const regFile = ri >= 0 ? args.splice(ri, 2)[1] : null;
const [catFile, seasonFile] = args.filter(a => !a.startsWith('--'));
if (!catFile || !seasonFile) { console.error('Укажите КАТАЛОГ.csv и СЕЗОН.csv'); process.exit(2); }
const VALID_FROM = '2026-08-01';

const catalog = parseCatalog(fs.readFileSync(catFile, 'utf8'));
const kits = new Map(catalog.map(k => [k.kit, k.price]));
const { orders, problems } = parseSeason(fs.readFileSync(seasonFile, 'utf8'), kits);

const dates = orders.filter(o => !o.ordered_on).length;
const discounts = orders.filter(o => Math.abs(o.line_sum - o.total) > 0.01);
const qty = orders.filter(o => o.lines.some(l => l.quantity > 1));
console.log(`${path.basename(catFile)}: позиций ${catalog.length}`);
console.log(`${path.basename(seasonFile)}: заказов ${orders.length}, сумма ${orders.reduce((a, o) => a + o.total, 0)} ₾, оплачено ${orders.reduce((a, o) => a + o.paid, 0)} ₾`);
console.log(`Без даты заказа: ${dates}. Со скидкой на набор (сумма ≠ позиции): ${discounts.length} (${discounts.map(o => o.ext_id).join(', ')}). С количеством больше 1: ${qty.length} (${qty.map(o => o.ext_id).join(', ')}).`);
console.log(`Проблем разбора: ${problems.length}`);
for (const p of problems) console.log(`  строка ${p.line}: ${p.id} — ${p.error}`);
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID } = process.env;
const haveEnv = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY && CLUB_ID);
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

// Проверка перед записью (только чтение): без неё запись по устаревшему листу или подмене данных (#277) молча перезапишет заказы и их строки.
if (regFile) {
  let db = null;
  if (haveEnv) {
    const ext = new Map((await getAll(rest, `players?club_id=eq.${CLUB_ID}&select=id,external_id`)).map(p => [p.id, p.external_id]));
    const lines = new Map();
    for (const l of await getAll(rest, 'equipment_order_lines?select=order_id,kit,size,quantity')) {
      if (!lines.has(l.order_id)) lines.set(l.order_id, []);
      lines.get(l.order_id).push({ kit: String(l.kit).trim(), size: l.size ? String(l.size).trim() : null, quantity: Number(l.quantity) || 1 });
    }
    db = (await getAll(rest, `equipment_orders?club_id=eq.${CLUB_ID}&select=id,external_ord_id,player_id,inscription,number,installment,total,paid`)).map(o => ({
      ext_id: o.external_ord_id, player_ext: ext.get(o.player_id) ?? '', inscription: o.inscription || null, number: o.number || null,
      installment: !!o.installment, total: Number(o.total) || 0, paid: Number(o.paid) || 0, lines: lines.get(o.id) ?? [],
    }));
  }
  const g = guardEquipment({ orders, registry: parseRegistry(fs.readFileSync(regFile, 'utf8')).players, db });
  const t = x => `заказов ${x.orders}, строк ${x.lines}, сумма ${x.total} ₾, оплачено ${x.paid} ₾`;
  console.log(`Лист: ${t(g.sheetTotals)}`);
  console.log(g.dbTotals ? `База: ${t(g.dbTotals)}` : 'База: сверка пропущена (нет SUPABASE_URL, ключа или CLUB_ID)');
  for (const n of g.notes) console.log(n);
  if (g.diffs.length) console.log(`Расхождения с базой по ID заказа (${g.diffs.length}); после записи в базе будет значение из листа:`);
  for (const d of g.diffs.slice(0, 60)) console.log('  ' + JSON.stringify(d));
  if (g.diffs.length > 60) console.log(`  … ещё ${g.diffs.length - 60}`);
  for (const [title, a] of [['ОШИБКИ', g.errors], ['ПРЕДУПРЕЖДЕНИЯ', g.warnings]]) if (a.length) { console.log(title + ':'); a.forEach(x => console.log('  ' + JSON.stringify(x))); }
  if (problems.length || g.errors.length || (g.warnings.length && !acceptWarnings)) {
    console.error(`Запись экипировки остановлена: ошибок ${problems.length + g.errors.length}, предупреждений ${g.warnings.length}${g.warnings.length && !acceptWarnings ? ' (просмотрите их; если всё верно — добавьте --accept-warnings)' : ''}.`);
    process.exit(1);
  }
}
if (!write) { console.log('Проверка без записи. Для записи добавьте --write.'); process.exit(0); }
if (problems.length) { console.error('Есть ошибки разбора — исправьте файл и запустите снова.'); process.exit(1); }
if (!haveEnv) { console.error('Нужны SUPABASE_URL, SUPABASE_SERVICE_KEY, CLUB_ID'); process.exit(2); }

// 1) каталог
await rest('POST', 'equipment_catalog?on_conflict=club_id,kit,valid_from',
  catalog.map(k => ({ club_id: CLUB_ID, kit: k.kit, price: k.price, valid_from: VALID_FROM })),
  'resolution=merge-duplicates,return=minimal');

// 2) игроки по external_id (KS-xxxx)
const players = await getAll(rest, `players?club_id=eq.${CLUB_ID}&select=id,external_id`);
const pid = new Map(players.map(p => [p.external_id, p.id]));
const missing = [...new Set(orders.map(o => o.player_ext).filter(x => !pid.has(x)))];
if (missing.length) { console.error('Игроки не найдены в базе (сначала реестр): ' + missing.join(', ')); process.exit(1); }

// 3) заказы
const rowsOrders = orders.map(o => ({
  club_id: CLUB_ID, external_ord_id: o.ext_id, player_id: pid.get(o.player_ext), ordered_on: o.ordered_on,
  inscription: o.inscription, number: o.number, installment: o.installment,
  total: o.total, paid: o.paid, location: o.location,
}));
for (let i = 0; i < rowsOrders.length; i += 500) {
  await rest('POST', 'equipment_orders?on_conflict=club_id,external_ord_id', rowsOrders.slice(i, i + 500), 'resolution=merge-duplicates,return=minimal');
}
const dbOrders = await getAll(rest, `equipment_orders?club_id=eq.${CLUB_ID}&select=id,external_ord_id`);
const oid = new Map(dbOrders.map(o => [o.external_ord_id, o.id]));

// 4) строки заказов: перезаписываем целиком (повторный запуск не дублирует)
const ids = orders.map(o => oid.get(o.ext_id)).filter(Boolean);
for (let i = 0; i < ids.length; i += 200) {
  await rest('DELETE', `equipment_order_lines?order_id=in.(${ids.slice(i, i + 200).join(',')})`, undefined, 'return=minimal');
}
const lines = orders.flatMap(o => o.lines.map(l => ({ order_id: oid.get(o.ext_id), kit: l.kit, size: l.size, quantity: l.quantity, unit_price: l.unit_price })));
for (let i = 0; i < lines.length; i += 500) {
  await rest('POST', 'equipment_order_lines', lines.slice(i, i + 500), 'return=minimal');
}
console.log(`Записано: позиций каталога ${catalog.length}, заказов ${orders.length}, строк заказов ${lines.length}.`);
