// Тип оплаты игрока (миграция 0200): «Платит за визит» вместо абонемента. Правило то же, что в базе (player_per_visit_month):
// месяцы начиная с месяца pay_mode_from абонементом не считаются (ни долга, ни строки «К оплате»).
export interface PayMode { pay_mode: string | null; pay_mode_from: string | null }
/** Первое число месяца даты ГГГГ-ММ-ДД. */
const firstOf = (d: string) => d.slice(0, 7) + '-01';
/** Месяц m (первое число, ГГГГ-ММ-01) игрока «за визит»: абонемент за него не предлагается. */
export const perVisitMonth = (pm: PayMode | null | undefined, m: string): boolean =>
  !!pm && pm.pay_mode === 'per_visit' && !!pm.pay_mode_from && m >= firstOf(pm.pay_mode_from);
