// Справочник филиалов клуба для фильтров (кассовый отчёт): три филиала. Разовые площадки (школа, отель) и места сборов в него не входят.
// Написания в данных могут отличаться (русское, грузинское, слитное); branchOf приводит их к названию справочника.
// Тот же перечень написаний использует db/ops/normalize-locations-2026-11-21.sql.
export const BRANCHES = ['Red Garden', 'Isani', 'Ortachala'] as const;
export type Branch = (typeof BRANCHES)[number];

const ALIASES: Record<Branch, string[]> = {
  'Red Garden': ['red garden', 'redgarden', 'ред гарден', 'редгарден', 'რედ გარდენ'],
  Isani: ['isani', 'исани', 'ისანი'],
  Ortachala: ['ortachala', 'ортачала', 'ორთაჭალა'],
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Название филиала справочника по написанию из данных; не филиал → null. */
export function branchOf(text: string | null | undefined): Branch | null {
  const t = norm(text ?? '');
  if (!t) return null;
  return BRANCHES.find(b => ALIASES[b].includes(t)) ?? null;
}

/** Сохранённое или выбранное значение фильтра: старое написание филиала («Исани») заменяется названием справочника, остальное остаётся как есть. */
export const canonicalLocation = (text: string): string => branchOf(text) ?? text.trim();

/** Список для выпадающего «Локация»: филиалы справочника; сохранённое значение не из справочника остаётся отдельной строкой, чтобы фильтр не терялся молча. */
export function locationOptions(current: string): string[] {
  const c = canonicalLocation(current);
  return c && !(BRANCHES as readonly string[]).includes(c) ? [c, ...BRANCHES] : [...BRANCHES];
}
