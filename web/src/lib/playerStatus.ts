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

/**
 * Ушедший игрок: месяцы после месяца ухода не оплачиваются. Дата ухода: последняя запись «ушёл» в журнале,
 * а если журнала нет, players.ends_on из старой таблицы. Месяц самого ухода остаётся платным.
 * Для игрока, который не ушёл (занимается, пауза), всегда false.
 */
export function afterLeftMonthTest(status: string | undefined, log: StatusLogPoint[], endsOn: string | null | undefined): (month: string) => boolean {
  if (status !== 'inactive') return () => false;
  const fromLog = [...log].filter(r => r.status === 'inactive').sort((a, b) => b.on_date.localeCompare(a.on_date))[0]?.on_date;
  const left = fromLog ?? endsOn ?? null;
  if (!left) return () => false;
  const leftMonth = `${left.slice(0, 7)}-01`;
  return (month: string) => month > leftMonth;
}

/**
 * Был ли игрок «Занимается» в указанный день (для списка отметок за прошедшую тренировку).
 * Берём последнюю запись журнала с on_date не позже дня. Если такой записи нет:
 * первая запись журнала «Занимается» значит, что до неё игрок не занимался (вернулся позже этого дня);
 * первая запись «Пауза»/«Ушёл» значит, что до неё он занимался; игрок без журнала: по текущему статусу.
 */
export function wasActiveOn(currentStatus: string | undefined, log: StatusLogPoint[], day: string): boolean {
  const rows = [...log].sort((a, b) => a.on_date.localeCompare(b.on_date) || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  if (rows.length === 0) return (currentStatus ?? 'active') === 'active';
  let at: StatusLogPoint | undefined;
  for (const r of rows) if (r.on_date <= day) at = r;
  if (at) return at.status === 'active';
  return rows[0].status !== 'active';
}
