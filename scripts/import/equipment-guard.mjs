// Проверка заказов экипировки перед записью (только чтение, чистая функция): объединяет проверку листа (equipment-check) и сверку с базой.
// Запись заказов перезаписывает суммы, оплату, игрока и пересоздаёт строки заказов, поэтому при подозрении на подмену данных (#277) запись должна остановиться.
import { checkEquipment } from './equipment-check.mjs';
import { compareWithDb } from './equipment-compare-db.mjs';

const sum = (a, f) => Math.round(a.reduce((s, x) => s + f(x), 0) * 100) / 100;
export const totalsOf = orders => ({ orders: orders.length, total: sum(orders, o => o.total), paid: sum(orders, o => o.paid), lines: orders.reduce((n, o) => n + o.lines.length, 0) });

// orders — parseSeason().orders, registry — players из parseRegistry, db — заказы базы в виде parseDbExport (или null, если базу не читали).
// errors всегда блокируют запись; warnings блокируют, пока владелец не просмотрел их и не передал --accept-warnings.
export function guardEquipment({ orders, registry, db = null }) {
  const { errors, warnings } = checkEquipment({ season: orders, registry });
  const notes = [], diffs = [];
  let dbTotals = null;
  if (db) {
    dbTotals = totalsOf(db);
    const r = compareWithDb(orders, db);
    diffs.push(...r.diffs);
    for (const d of r.diffs) {
      // заказ того же номера принадлежит другому игроку: признак подмены (#277) или перепривязки в приложении
      if (d.field === 'player_ext') warnings.push({ ord: d.ord, kind: 'игрок заказа в листе и в базе разный', sheet: d.sheet, db: d.db });
      // в базе оплачено больше, чем в листе: запись затрёт оплату, принятую в новом приложении
      if (d.field === 'paid' && Number(d.db) - Number(d.sheet) > 0.005) warnings.push({ ord: d.ord, kind: 'в базе оплачено больше, чем в листе', sheet: d.sheet, db: d.db });
    }
    if (r.onlyDb.length) notes.push(`Заказов только в базе (запись их не меняет и не удаляет): ${r.onlyDb.length}: ${r.onlyDb.slice(0, 20).join(', ')}`);
    if (r.onlySheet.length) notes.push(`Новых заказов (есть в листе, нет в базе): ${r.onlySheet.length}`);
  }
  return { errors, warnings, notes, diffs, sheetTotals: totalsOf(orders), dbTotals };
}
