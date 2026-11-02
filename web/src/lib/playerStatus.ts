// Статусы игрока: «занимается», «пауза» (вернётся) и «ушёл» (в базе inactive; гости из импорта тоже inactive).
export type PlayerStatus = 'active' | 'paused' | 'inactive';

export const isGuest = (externalId?: string | null) => Boolean(externalId && externalId.startsWith('GUEST-'));

export function statusLabel(s: string | undefined, externalId?: string | null): string {
  if (s === 'paused') return 'Пауза';
  if (s === 'inactive') return isGuest(externalId) ? 'Гость' : 'Ушёл';
  return 'Занимается';
}

export const statusTone = (s: string | undefined): 'success' | 'warning' | 'neutral' => (s === 'paused' ? 'warning' : s === 'inactive' ? 'neutral' : 'success');
