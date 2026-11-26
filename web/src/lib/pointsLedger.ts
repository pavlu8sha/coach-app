import { supabase } from './supabase';
import { errMsg } from './coach';
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
      // Баллы за матч: оценка тренера 1-5 и +1 лучшему игроку (с 0223). Победа, ничья, поражение и голы основанием не бывают.
      if (c.model === 'rating') {
        const bonus = num(c.best_bonus);
        const capped = num(c.before_cap) > r.points && num(c.cap) > 0 ? `ограничено максимумом ${num(c.cap)} за матч` : '';
        const detail = [bonus > 0 ? `лучший игрок +${bonus}` : '', capped].filter(Boolean).join(' · ');
        return { title: `Матч — оценка тренера ${num(c.rating)}`, detail: detail || undefined };
      }
      // записи тестового периода, посчитанные по прежним правилам: основание не расшифровываем
      return { title: 'Матч (по прежним правилам)' };
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

// Суммы действующих баллов игроков по новому журналу; ошибка загрузки возвращается строкой
export async function fetchLedgerTotals(ids: string[]): Promise<{ totals: Record<string, number>; error: string | null }> {
  const totals: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 100) {
    for (let from = 0; ; from += 1000) {
      const e = await supabase.from('points_ledger').select('player_id, points').eq('status', 'active').in('player_id', ids.slice(i, i + 100)).order('id').range(from, from + 999);
      if (e.error) return { totals, error: errMsg(e.error) };
      for (const r of (e.data ?? []) as { player_id: string; points: number }[]) totals[r.player_id] = (totals[r.player_id] ?? 0) + r.points;
      if ((e.data ?? []).length < 1000) break;
    }
  }
  return { totals, error: null };
}
