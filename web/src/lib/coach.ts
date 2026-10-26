// Общее для экранов тренера и администратора.
export interface CoachGroup { id: string; name: string }

export const DAYS = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const fmtDate = (iso: string) => iso.split('-').reverse().join('.');
export const fmtShort = (iso: string) => iso.split('-').reverse().slice(0, 2).join('.');
export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD по местному времени телефона
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
};
/** День недели 1 (пн) … 7 (вс), как weekday в расписании. */
export const isoDow = (iso: string) => ((new Date(iso + 'T12:00:00').getDay() + 6) % 7) + 1;
export const hm = (t: string | null) => (t ? t.slice(0, 5) : '');
export const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'балл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'балла' : 'баллов');

/** Понятный текст по ошибке функций базы (миграции 0018–0020); неизвестную ошибку показываем как есть. */
export function coachError(m: string): string {
  const map: [string, string][] = [
    ['forbidden', 'Нет прав на это действие для выбранной группы.'],
    ['no training scheduled', 'В этот день нет занятия по расписанию группы.'],
    ['date in the future', 'Нельзя отметить занятие, которое ещё не прошло.'],
    ['result for future match', 'Счёт нельзя внести для матча, который ещё не прошёл.'],
    ['score incomplete', 'Укажите оба числа счёта или оставьте оба пустыми.'],
    ['goals exceed team score', 'Голов у игроков больше, чем забила команда.'],
    ['goals without playing', 'Гол записан игроку, который не играл.'],
    ['player not in group', 'Игрок не из этой группы.'],
    ['player not in club', 'Игрок не из этого клуба.'],
    ['only one best player', 'Лучший игрок может быть только один.'],
    ['best player must have played', 'Лучшим может быть только тот, кто играл.'],
    ['match has fees', 'У матча есть взносы: удалить его нельзя.'],
    ['group required', 'Выберите группу для нового матча.'],
    ['match is not of this group', 'Этот матч принадлежит другой группе.'],
    ['points must be between', 'Баллы: от 1 до 5.'],
    ['note required', 'Напишите, за что баллы.'],
    ['note too long', 'Комментарий слишком длинный (до 200 знаков).'],
    ['bonus not found', 'Начисление не найдено или уже отменено.'],
    ['fee already paid', 'Взнос уже оплачен: убрать игрока нельзя.'],
    ['event not found', 'Событие не найдено.'],
    ['not found', 'Не настроено правило начисления баллов. Сообщите администратору.'],
    ['Could not find the function', 'Эта функция ещё не установлена в базе. Сообщите администратору.'],
    ['schema cache', 'Эта функция ещё не установлена в базе. Сообщите администратору.'],
  ];
  return map.find(([k]) => m.includes(k))?.[1] ?? m;
}
