// Статусы игрока: «занимается», «пауза» (вернётся) и «ушёл» (в базе inactive; гости из импорта тоже inactive).
export type PlayerStatus = 'active' | 'paused' | 'inactive';

export const isGuest = (externalId?: string | null) => Boolean(externalId && externalId.startsWith('GUEST-'));

export function statusLabel(s: string | undefined, externalId?: string | null): string {
  if (s === 'paused') return 'Пауза';
  if (s === 'inactive') return isGuest(externalId) ? 'Гость' : 'Ушёл';
  return 'Занимается';
}

export const statusTone = (s: string | undefined): 'success' | 'warning' | 'neutral' => (s === 'paused' ? 'warning' : s === 'inactive' ? 'neutral' : 'success');

export interface StatusLogPoint { status: string; on_date: string; created_at?: string }

/**
 * Месяц «на паузе», если он целиком внутри периода паузы: пауза началась не позже 1-го числа,
 * а возвращение (следующая запись журнала) не раньше 1-го числа следующего месяца. Платить за такой месяц не нужно.
 * Месяц, в который игрок вернулся посреди месяца или ушёл на паузу посреди месяца, остаётся платным.
 */
export function pausedMonthTest(log: StatusLogPoint[]): (month: string) => boolean {
  const rows = [...log].sort((a, b) => a.on_date.localeCompare(b.on_date) || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  const spans: { from: string; to: string | null }[] = [];
  rows.forEach((r, i) => {
    if (r.status === 'paused') spans.push({ from: r.on_date, to: rows[i + 1]?.on_date ?? null });
  });
  return (month: string) => {
    const d = new Date(`${month}T12:00:00`);
    const next = `${new Date(d.getFullYear(), d.getMonth() + 1, 1, 12).toISOString().slice(0, 7)}-01`;
    return spans.some(s => s.from <= month && (s.to === null || s.to >= next));
  };
}
