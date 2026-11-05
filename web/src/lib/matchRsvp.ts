// Подтверждение участия в матчах (миграции 0134, 0136): типы ответов функций базы и общие подписи.
export type RsvpResponse = 'yes' | 'no';
export type Lifecycle = 'legacy' | 'draft' | 'published' | 'cancelled';

/** Строка match_rsvp_my_matches(): один ребёнок одного матча (родитель видит только своих детей). */
export interface MyRsvp {
  match_id: string; lifecycle_status: 'published' | 'cancelled'; kind: string | null; team: string; opponent: string | null;
  starts_at: string; venue: string | null; address: string | null; notes: string | null; rescheduled: boolean;
  player_id: string; player_name: string; response: RsvpResponse | null; responded_by_name: string | null;
  responded_at: string | null; answer_until: string | null; can_answer: boolean;
}

export const RESPONSE_LABEL: Record<RsvpResponse, string> = { yes: 'Будет', no: 'Не будет' };
/** Нет ответа — это не вариант ответа родителя, а отдельное состояние «Не ответил». */
export const responseText = (r: RsvpResponse | null) => (r ? RESPONSE_LABEL[r] : 'Не ответил');
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = { legacy: 'Без подтверждения', draft: 'Черновик', published: 'Опубликован', cancelled: 'Отменён' };

const TZ = 'Asia/Tbilisi';
const parts = (iso: string) => {
  const o: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))) o[p.type] = p.value;
  return o;
};
/** «05.11.2026 17:30» по времени клуба (Asia/Tbilisi), а не телефона. */
export function fmtWhen(iso: string): string {
  const p = parts(iso);
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}
/** Значение для поля datetime-local из момента времени, по часам Тбилиси. */
export function toTbilisiLocal(iso: string): string {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** Из поля datetime-local (время клуба) в момент времени для базы. В Грузии нет перехода на летнее время: UTC+4. */
export function fromTbilisiLocal(local: string): string {
  return `${local.length === 16 ? local + ':00' : local}+04:00`;
}

const ERRORS: [string, string][] = [
  ['answers are closed', 'Приём ответов закрыт'],
  ['match is cancelled', 'Матч отменён'],
  ['match already started', 'Матч уже начался'],
  ['no invited players', 'Добавьте в состав хотя бы одного игрока'],
  ['start in the past', 'Время начала должно быть в будущем'],
  ['date change requires reschedule', 'Дату меняет только перенос матча'],
  ['field is fixed after publish', 'Это поле после публикации не меняется'],
  ['event is finished', 'Событие завершено'],
  ['player is not of this club', 'Игрок из другого клуба'],
  ['start time required', 'Укажите дату и время начала'],
  ['team required', 'Укажите команду'],
  ['match is not published', 'Матч не опубликован'],
  ['only draft can be deleted', 'Удалить можно только черновик'],
  ['only draft can be published', 'Опубликовать можно только черновик'],
  ['match already has marks', 'На матче уже есть новые отметки'],
  ['forbidden', 'Нет доступа'],
];
export function rsvpError(message: string): string {
  const hit = ERRORS.find(([k]) => message.includes(k));
  return hit ? hit[1] : message;
}
