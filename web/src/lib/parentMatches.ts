// Общие правила показа матчей родителю и ребёнку (docs/PARENT_MATCHES_VISUAL_ACCEPTANCE.md, О1-О5).
export type ResultKind = 'w' | 'd' | 'l' | 'n';
export type Participation = 'played' | 'not' | null;
export interface Part { played: boolean; goals: number; best?: boolean; rating?: number | null }

/** Результат матча для светофора; без счёта — нейтральный. */
export const resultKind = (gf: number | null, ga: number | null): ResultKind => (gf === null || ga === null ? 'n' : gf > ga ? 'w' : gf < ga ? 'l' : 'd');
export const RESULT_LETTER: Record<'w' | 'd' | 'l', string> = { w: 'В', d: 'Н', l: 'П' };
export const RESULT_NAME: Record<'w' | 'd' | 'l', string> = { w: 'Победа', d: 'Ничья', l: 'Поражение' };

/** Баллы за матч: оценка (1-5) и +1 лучшему, не больше 6 (0223). */
export const matchPoints = (rating: number, best: boolean) => Math.min(rating + (best ? 1 : 0), 6);

/**
 * «Играл» / «Не играл» для своего ребёнка. «Не играл» — строка с played = false, либо строки нет, а матч не раньше первой записи
 * ребёнка (раньше ребёнка в команде не было). Без записей вообще пометки нет.
 */
export function participation(part: Part | undefined, playedOn: string, firstOn: string | null): Participation {
  if (part) return part.played ? 'played' : 'not';
  return firstOn !== null && playedOn >= firstOn ? 'not' : null;
}

/** Дата первого матча, по которому у ребёнка есть запись об участии. */
export const firstRecordDate = (dates: string[]): string | null => (dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null);
