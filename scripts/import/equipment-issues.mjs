// Выдача экипировки из листа «ВЫДАЧА» старого приложения (EquipIssue.js): одна строка на выданную вещь заказа.
// Итоговый импорт заказы и оплаты переносил, а выдачи нет. Только чистые функции.
import { parseCsv } from './registry.mjs';
import { isoDate } from './payment-dates.mjs';

/** ВЫДАЧА.csv (ID заказа, Вещь, Дата выдачи, Кто выдал, …) → [{ord, kit, date, who, line}] */
export function parseIssues(text) {
  const [, ...rows] = parseCsv(text).filter(r => r.some(x => String(x).trim()));
  return rows.map((r, i) => ({ ord: (r[0] || '').trim(), kit: (r[1] || '').trim(), date: isoDate(r[2]), rawDate: (r[2] || '').trim(), who: (r[3] || '').trim() || null, line: i + 2 }))
    .filter(x => x.ord && x.kit);
}

/**
 * orders: Map «ORD-xxxx» → { id, kits: Set(вещи заказа) }; have: Set «orderId|вещь» уже выданных в базе.
 * Добавляются только отсутствующие выдачи; уже выданное не меняется. Остальное — в отчёт.
 */
export function planIssues({ issues, orders, have }) {
  const add = [], skipped = { noOrder: new Set(), noKit: [], badDate: [] };
  const seen = new Set();
  for (const x of issues) {
    const o = orders.get(x.ord);
    if (!o) { skipped.noOrder.add(x.ord); continue; }
    if (!o.kits.has(x.kit)) { skipped.noKit.push({ ord: x.ord, kit: x.kit }); continue; }
    if (x.rawDate && !x.date) { skipped.badDate.push({ ord: x.ord, kit: x.kit, rawDate: x.rawDate }); }
    const key = `${o.id}|${x.kit}`;
    if (seen.has(key) || have.has(key)) continue;
    seen.add(key);
    add.push({ order_id: o.id, kit: x.kit, issued_on: x.date, issued_by: x.who, ord: x.ord });
  }
  return { add, skipped };
}
