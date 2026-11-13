// Что на сборе требует действия администратора (условия 66-68, аудит 11.11 C-01 и C-02). Только расчёт для показа:
// статусы, места и деньги меняет человек в карточке участника.
interface PartLike { id: string; status: 'registered' | 'declined' | 'cancelled'; camp_payments: { amount: number | string }[] }
interface CampLike { booking_fee: number | string | null; booking_deadline: string | null }

const cents = (n: number) => Math.round(n * 100) / 100;

/** Внесено с учётом возвратов и отмен платежей (они в журнале с минусом). */
export const netPaid = (p: Pick<PartLike, 'camp_payments'>) => cents(p.camp_payments.reduce((s, x) => s + Number(x.amount), 0));

/** Сегодня по времени клуба (YYYY-MM-DD). */
export const tbilisiToday = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' });

export function campAttention<P extends PartLike>(camp: CampLike, parts: P[], today = tbilisiToday()) {
  const fee = Number(camp.booking_fee ?? 0);
  const late = !!camp.booking_deadline && fee > 0 && today > camp.booking_deadline;
  const refunds = parts.filter(p => p.status !== 'registered' && netPaid(p) > 0).map(p => ({ ...p, paid: netPaid(p) }));
  const noBooking = late ? parts.filter(p => p.status === 'registered' && netPaid(p) < fee).map(p => ({ ...p, paid: netPaid(p) })) : [];
  return { refunds, noBooking, fee };
}
