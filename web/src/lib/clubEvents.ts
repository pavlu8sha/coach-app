// «Мероприятия» (Issue #677, этап 4): общие подписи, цвета статусов, тексты ошибок базы. Деньги и правила считает база; здесь только показ.
import type { Tone } from '../ui/components';

export type EventStatus = 'draft' | 'active' | 'finished' | 'cancelled';

export interface ClubEvent {
  id: string; name: string; description?: string | null; starts_on: string; starts_time: string | null; place: string | null; base_price: number | string;
  signup_deadline: string | null; capacity: number | null; status: EventStatus; active_count?: number; free_places?: number | null; over_limit?: boolean;
  club_wide?: boolean; group_ids?: string[]; group_names?: string[];
  finance?: { counted: number | string; debt: number | string; overpay: number | string };
}

export interface Participant {
  id: string; player_id: string; full_name: string; group_id: string | null; group_name: string | null; player_status: string; status: 'active' | 'cancelled';
  base_price: number | string; individual_price: number | string | null; price: number | string; counted: number | string; debt: number | string; overpay: number | string;
  pay_state: 'debt' | 'overpaid' | 'paid'; not_in_group: boolean;
}

// Статусы мероприятия по макету v3 (UI9, UI18): цвет всегда сопровождается текстом
export const STATUS_LABEL: Record<EventStatus, string> = { draft: 'Черновик', active: 'Активное', finished: 'Завершённое', cancelled: 'Отменённое' };
export const STATUS_TONE: Record<EventStatus, Tone> = { draft: 'primary', active: 'success', finished: 'neutral', cancelled: 'danger' };
export const RECORD_LABEL: Record<Participant['status'], string> = { active: 'Активна', cancelled: 'Отменена' };
export const RECORD_TONE: Record<Participant['status'], Tone> = { active: 'success', cancelled: 'danger' };

export const num = (v: number | string | null | undefined) => Number(v ?? 0);
export const gel = (v: number | string) => { const n = num(v); return `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`; };
export const parseMoney = (s: string) => Number(s.trim().replace(',', '.'));
export const moneyOk = (n: number) => Number.isFinite(n) && n >= 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 && n < 100000000;

const ruDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

/** Дата обязательна, время нет (UI13): без времени показывается только дата, иначе «дата · время». */
export const whenText = (date: string, time: string | null | undefined) => (time ? `${ruDate(date)} · ${time.slice(0, 5)}` : ruDate(date));
export const deadlineText = (v: string) => `${ruDate(v)} ${v.slice(11, 16)}`.trim();

/** Свободные места по данным списка: «Лимит: N», «Свободно: M» или «Без лимита». */
export const seatsText = (e: Pick<ClubEvent, 'capacity' | 'free_places'>) => (e.capacity == null ? 'Без лимита' : `Лимит: ${e.capacity} · Свободно: ${e.free_places ?? 0}`);

export function clubEventErr(m: string): string {
  if (m.includes('event full')) return 'Нет свободных мест.';
  if (m.includes('already participating')) return 'Игрок уже участвует (возможно, запись отменена: восстановите её).';
  if (m.includes('player not active')) return 'Игрок не в статусе «Занимается».';
  if (m.includes('event not active')) return 'Запись возможна только в активном мероприятии.';
  if (m.includes('deadline passed')) return 'Срок записи уже прошёл.';
  if (m.includes('event not open for payments')) return 'Оплаты принимаются только в активном или завершённом мероприятии.';
  if (m.includes('participant cancelled')) return 'Запись отменена: платёж не принимается.';
  if (m.includes('price below counted')) return 'Цена отменённой записи не может быть ниже уже оплаченного.';
  if (m.includes('price change needs reason')) return 'Укажите причину изменения цены (не короче 3 символов).';
  if (m.includes('only draft can be deleted')) return 'Удалить можно только черновик.';
  if (m.includes('event has participants')) return 'У черновика есть участники: удалить его нельзя.';
  if (m.includes('event deleted')) return 'Мероприятие уже удалено.';
  if (m.includes('transition not allowed')) return 'Такой переход статуса недоступен.';
  if (m.includes('request id reused')) return 'Этот запрос уже использован с другими данными. Откройте форму заново.';
  if (m.includes('bad date')) return 'Дата платежа не может быть в будущем.';
  if (m.includes('bad amount')) return 'Сумма указана неверно.';
  if (m.includes('bad price')) return 'Цена указана неверно.';
  if (m.includes('bad capacity')) return 'Лимит: целое число от 1 или пусто.';
  if (m.includes('bad name')) return 'Введите название (до 200 символов).';
  if (m.includes('date required')) return 'Укажите дату.';
  if (m.includes('forbidden')) return 'Нет доступа.';
  if (m.includes('Could not find the function') || m.includes('club_event')) return 'Раздел ещё не установлен в базе (миграции 0202, 0204, 0210).';
  return m;
}
