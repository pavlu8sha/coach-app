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

/** Ошибка «колонки нет» (миграция ещё не применена): PostgREST 42703 или «does not exist / schema cache». Остальные ошибки — настоящие сбои. */
export const isMissingColumn = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === '42703' || /does not exist|schema cache/i.test(e.message ?? ''));

/**
 * Тип оплаты игрока. Без миграции 0229 колонки pay_mode_until нет — читаем прежние колонки (0200); без 0200 — null (панели нет).
 * Любой другой сбой запроса — исключение: вызывающий показывает ошибку, а не «игрок на абонементе» (иначе игроку «за визит» показался бы долг по абонементу).
 */
export async function loadPayMode(playerId: string): Promise<PayMode | null> {
  const r = await supabase.from('players').select('pay_mode, pay_mode_from, pay_mode_until').eq('id', playerId).maybeSingle();
  if (!r.error) return (r.data as PayMode | null) ?? null;
  if (!isMissingColumn(r.error)) throw new Error(r.error.message);
  const old = await supabase.from('players').select('pay_mode, pay_mode_from').eq('id', playerId).maybeSingle();
  if (!old.error) return (old.data as PayMode | null) ?? null;
  if (isMissingColumn(old.error)) return null;
  throw new Error(old.error.message);
}
