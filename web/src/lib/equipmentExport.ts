import { compareGroups } from './coach';
// Выгрузка заказов экипировки в CSV (docs/acceptance/eq-export-csv-2026-11-09.md).
// Колонки и порядок строк совпадают с эталонным запросом db/ops/readonly-raincoats-2026-11-09.sql.
// Только форматирование уже загруженных заказов: в базу не пишем и RPC не вызываем.
export interface ExportOrder {
  id: string; ordered_on: string | null; number: string | null; location: string | null;
  players: { full_name: string; groups?: { name: string } | null } | null;
  equipment_order_lines: { kit: string; size: string | null; quantity: number }[];
  equipment_issues?: { kit: string }[];
}

export const CSV_BOM = '﻿';
const HEAD = ['дата заказа', 'номер', 'игрок', 'группа', 'локация', 'вещь', 'размер', 'количество', 'id заказа'];

// Текст ячейки: защита от формул (= + - @) и кавычки по правилам CSV.
const cell = (v: string | number | null | undefined, isText = true): string => {
  let s = v == null ? '' : String(v);
  if (isText && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Текст CSV или пустая строка, если подходящих строк нет. kit — фильтр «Товар» (пустая строка = все вещи); lineOk — доп. условие на вещь (например, по состоянию выдачи). */
export function equipmentCsv(orders: ExportOrder[], kit: string, lineOk?: (o: ExportOrder, kit: string) => boolean): string {
  // как в эталоне: по дате заказа, затем по имени игрока (сортировка устойчивая, вещи внутри заказа остаются в своём порядке)
  const sorted = [...orders].sort((a, b) =>
    (a.ordered_on ?? '￿').localeCompare(b.ordered_on ?? '￿') || (a.players?.full_name ?? '').localeCompare(b.players?.full_name ?? '', 'ru'));
  const rows: string[] = [];
  for (const o of sorted) {
    for (const l of o.equipment_order_lines) {
      if (kit && l.kit !== kit) continue;
      if (lineOk && !lineOk(o, l.kit)) continue;
      rows.push([
        cell(o.ordered_on, false), cell(o.number), cell(o.players?.full_name), cell(o.players?.groups?.name), cell(o.location),
        cell(l.kit), cell(l.size), cell(l.quantity, false), cell(o.id, false),
      ].join(';'));
    }
  }
  return rows.length ? CSV_BOM + [HEAD.join(';'), ...rows].join('\r\n') : '';
}

export const csvFileName = (isoDate: string) => `equipment-${isoDate}.csv`;

// Режим «Не заказан» (docs/acceptance/eq-not-ordered-filter-2026-11-13.md): список строится от активных игроков, а не от заказов.
export interface RosterPlayer { id: string; full_name: string; status: string; groups?: { name: string } | null }
export interface NotOrderedOrder { player_id: string | null; status?: string | null; equipment_order_lines: { kit: string }[] }

/** Активные игроки без неотменённого заказа с вещью kit; q — поиск по имени, group — название группы (пустая строка = любые). */
export function notOrderedPlayers(players: RosterPlayer[], orders: NotOrderedOrder[], kit: string, q: string, group: string): RosterPlayer[] {
  const have = new Set(orders.filter(o => o.status !== 'cancelled' && o.player_id && o.equipment_order_lines.some(l => l.kit === kit)).map(o => o.player_id as string));
  const t = q.trim().toLowerCase();
  return players
    .filter(p => p.status === 'active' && !have.has(p.id) && (!t || p.full_name.toLowerCase().includes(t)) && (!group || p.groups?.name === group))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'));
}

export function notOrderedCsv(players: RosterPlayer[]): string {
  if (!players.length) return '';
  const g = (p: RosterPlayer) => p.groups?.name ?? '';
  const sorted = [...players].sort((a, b) => (!g(a) ? 1 : 0) - (!g(b) ? 1 : 0) || compareGroups(g(a), g(b)) || a.full_name.localeCompare(b.full_name, 'ru'));
  // Блоки: название группы, под ней игроки, между группами пустая строка.
  const out: string[] = [];
  sorted.forEach((p, i) => {
    if (i === 0 || g(p) !== g(sorted[i - 1])) { if (i > 0) out.push(''); out.push(cell(g(p) || 'Без группы')); }
    out.push(cell(p.full_name));
  });
  return CSV_BOM + out.join('\r\n');
}

export const notOrderedFileName = (isoDate: string) => `equipment-not-ordered-${isoDate}.csv`;
