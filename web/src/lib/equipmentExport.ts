import { orderStatusLabel } from './equipment';

// Выгрузка заказов экипировки в CSV (docs/acceptance/eq-export-csv-2026-11-09.md).
// Только форматирование уже загруженных заказов: в базу не пишем и RPC не вызываем.
export interface ExportOrder {
  id: string; ordered_on: string | null; number: string | null; inscription: string | null; location: string | null;
  status: string; total: number; paid: number;
  players: { full_name: string; groups?: { name: string } | null } | null;
  equipment_order_lines: { kit: string; size: string | null; quantity: number }[];
  equipment_issues: { kit: string }[];
}

const BOM = '﻿';
const HEAD = ['Дата заказа', 'Номер', 'Игрок', 'Группа', 'Локация', 'Вещь', 'Размер', 'Количество', 'Надпись', 'Статус', 'Оплачено', 'Сумма заказа', 'Выдано'];

// Текст ячейки: защита от формул (= + - @) и кавычки по правилам CSV.
const cell = (v: string | number | null | undefined, isText = true): string => {
  let s = v == null ? '' : String(v);
  if (isText && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Текст CSV или пустая строка, если подходящих строк нет. kit — фильтр «Товар» (пустая строка = все вещи). */
export function equipmentCsv(orders: ExportOrder[], kit: string): string {
  const rows: string[] = [];
  for (const o of orders) {
    for (const l of o.equipment_order_lines) {
      if (kit && l.kit !== kit) continue;
      rows.push([
        cell(o.ordered_on, false), cell(o.number), cell(o.players?.full_name), cell(o.players?.groups?.name ?? 'Без группы'), cell(o.location),
        cell(l.kit), cell(l.size), cell(l.quantity, false), cell(o.inscription), cell(orderStatusLabel(o.status)),
        cell(o.paid, false), cell(o.total, false), o.equipment_issues.some(i => i.kit === l.kit) ? 'Да' : 'Нет',
      ].join(';'));
    }
  }
  return rows.length ? BOM + [HEAD.join(';'), ...rows].join('\r\n') : '';
}

export const csvFileName = (isoDate: string) => `equipment-${isoDate}.csv`;
