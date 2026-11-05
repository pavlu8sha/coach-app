// Новый журнал баллов (#18): подписи начислений, месячные итоги. Чистые функции, чтобы родитель, ребёнок и тренер видели одинаковый текст.
export interface LedgerRow {
  id: string;
  event_date: string;
  points: number;
  source_type: string;
  reason_code: string;
  components: Record<string, unknown> | null;
  status?: string;
}

export interface Label { title: string; detail?: string }

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const num = (v: unknown) => (typeof v === 'number' ? v : 0);

export const monthOf = (iso: string) => iso.slice(0, 7);
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;
export const shiftMonth = (ym: string, d: number) => {
  const n = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + d;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
};

export function ledgerLabel(r: LedgerRow): Label {
  const c = r.components ?? {};
  switch (r.source_type) {
    case 'group_session':
      return { title: c.class === 'moved' ? 'Перенесённая тренировка — посещение' : c.class === 'unscheduled' ? 'Внеплановая тренировка — посещение' : 'Тренировка — посещение' };
    case 'individual':
      return { title: 'Индивидуальная тренировка — посещение' };
    case 'goalkeeper':
      return { title: 'Вратарская тренировка — посещение' };
    case 'extra':
      return { title: 'Дополнительная тренировка — посещение' };
    case 'match': {
      const res = c.technical ? 'технический результат' : c.result === 'win' ? 'победа' : c.result === 'draw' ? 'ничья' : 'поражение';
      const parts = [
        num(c.base) > 0 ? `участие +${num(c.base)}` : '',
        num(c.goals) > 0 ? `голы +${num(c.goals)}` : '',
        num(c.best) > 0 ? `лучший игрок +${num(c.best)}` : '',
      ].filter(Boolean);
      const capped = num(c.before_cap) > r.points && num(c.cap) > 0 ? `ограничено максимумом ${num(c.cap)} за матч` : '';
      return { title: `Матч — ${res}`, detail: [parts.join(', '), capped].filter(Boolean).join(' · ') || undefined };
    }
    case 'series_bonus':
      return { title: `Серия: ${num(c.threshold)} тренировок подряд` };
    case 'manual':
      return { title: `От тренера: ${typeof c.note === 'string' && c.note ? c.note : 'без комментария'}` };
    default:
      return { title: 'Начисление' };
  }
}

export const monthTotal = (rows: LedgerRow[], ym: string) => rows.filter(r => monthOf(r.event_date) === ym).reduce((s, r) => s + r.points, 0);
export const grandTotal = (rows: LedgerRow[]) => rows.reduce((s, r) => s + r.points, 0);
export const latestMonth = (rows: LedgerRow[], fallback: string) => rows.reduce((m, r) => (monthOf(r.event_date) > m ? monthOf(r.event_date) : m), rows.length ? monthOf(rows[0].event_date) : fallback);
