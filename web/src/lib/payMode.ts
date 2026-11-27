import { supabase } from './supabase';

// Тип оплаты игрока (миграции 0200, 0229): «Платит за визит» вместо абонемента. Правило то же, что в базе (player_per_visit_month):
// месяцы с месяца pay_mode_from абонементом не считаются (ни долга, ни строки «К оплате»); при возврате на абонемент период заканчивается
// месяцем pay_mode_until (дата возврата): месяц возврата уже абонементный.
export interface PayMode { pay_mode: string | null; pay_mode_from: string | null; pay_mode_until?: string | null }
/** Первое число месяца даты ГГГГ-ММ-ДД. */
const firstOf = (d: string) => d.slice(0, 7) + '-01';
/** Месяц m (первое число, ГГГГ-ММ-01) игрока «за визит»: абонемент за него не предлагается. */
export const perVisitMonth = (pm: PayMode | null | undefined, m: string): boolean =>
  !!pm && !!pm.pay_mode_from && m >= firstOf(pm.pay_mode_from)
  && ((pm.pay_mode === 'per_visit' && !pm.pay_mode_until) || (!!pm.pay_mode_until && m < firstOf(pm.pay_mode_until)));

/** Тип оплаты игрока; без миграции 0229 колонки pay_mode_until нет — читаем прежние колонки (0200); без 0200 — null. */
export async function loadPayMode(playerId: string): Promise<PayMode | null> {
  const r = await supabase.from('players').select('pay_mode, pay_mode_from, pay_mode_until').eq('id', playerId).maybeSingle();
  if (!r.error) return (r.data as PayMode | null) ?? null;
  const old = await supabase.from('players').select('pay_mode, pay_mode_from').eq('id', playerId).maybeSingle();
  return old.error ? null : ((old.data as PayMode | null) ?? null);
}
