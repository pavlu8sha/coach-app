// Выгрузка заказов экипировки в CSV (docs/acceptance/eq-export-csv-2026-11-09.md).
// Колонки и порядок строк совпадают с эталонным запросом db/ops/readonly-raincoats-2026-11-09.sql.
// Только форматирование уже загруженных заказов: в базу не пишем и RPC не вызываем.
export interface ExportOrder {
  id: string; ordered_on: string | null; number: string | null; location: string | null;
  players: { full_name: string; groups?: { name: string } | null } | null;
  equipment_order_lines: { kit: string; size: string | null; quantity: number }[];
}

export const CSV_BOM = '﻿';
const HEAD = ['дата заказа', 'номер', 'игрок', 'группа', 'локация', 'вещь', 'размер', 'количество', 'id заказа'];

// Текст ячейки: защита от формул (= + - @) и кавычки по правилам CSV.
const cell = (v: string | number | null | undefined, isText = true): string => {
  let s = v == null ? '' : String(v);
  if (isText && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Текст CSV или пустая строка, если подходящих строк нет. kit — фильтр «Товар» (пустая строка = все вещи). */
export function equipmentCsv(orders: ExportOrder[], kit: string): string {
  // как в эталоне: по дате заказа, затем по имени игрока (сортировка устойчивая, вещи внутри заказа остаются в своём порядке)
  const sorted = [...orders].sort((a, b) =>
    (a.ordered_on ?? '￿').localeCompare(b.ordered_on ?? '￿') || (a.players?.full_name ?? '').localeCompare(b.players?.full_name ?? '', 'ru'));
  const rows: string[] = [];
  for (const o of sorted) {
    for (const l of o.equipment_order_lines) {
      if (kit && l.kit !== kit) continue;
      rows.push([
        cell(o.ordered_on, false), cell(o.number), cell(o.players?.full_name), cell(o.players?.groups?.name), cell(o.location),
        cell(l.kit), cell(l.size), cell(l.quantity, false), cell(o.id, false),
      ].join(';'));
    }
  }
  return rows.length ? CSV_BOM + [HEAD.join(';'), ...rows].join('\r\n') : '';
}

export const csvFileName = (isoDate: string) => `equipment-${isoDate}.csv`;
