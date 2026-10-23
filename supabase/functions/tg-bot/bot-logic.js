// Сообщения бота клуба: /start → приветствие с кнопкой «Далее» → что важно знать, «Наш канал» и «Открыть приложение».
// Чистая функция: принимает update Telegram, возвращает список вызовов Bot API. Сеть и секреты — в index.ts.

export const CHANNEL_URL = 'https://t.me/fc_kickstart_tbs';

export const WELCOME = [
  'Добро пожаловать в FC KickStart Tbilisi ⚽',
  '',
  'Мы сделали это приложение, чтобы у родителей, детей и тренеров клуба всё самое важное было в одном месте.',
  '',
  'Здесь вы найдёте:',
  '',
  '▸ Расписание тренировок всех групп и ближайшие матчи',
  '▸ Результаты матчей и рейтинговые баллы ребёнка',
  '▸ Посещаемость тренировок',
  '▸ Оплату занятий по месяцам',
  '▸ Для тренеров: отметки посещаемости, состав и счёт матчей, баллы группы',
  '',
  'Мы только в начале пути и развиваем приложение вместе с вами. Каждый отзыв делает его лучше.',
].join('\n');

export const BEFORE_START = [
  'Перед началом, пожалуйста, обратите внимание:',
  '',
  '▸ При первом входе выберите роль: родитель, тренер, ребёнок или гость. Её можно сменить позже',
  '',
  '▸ Родителю нужно найти ребёнка по фамилии и имени, как они записаны в клубе. Администратор подтвердит, что это ваш ребёнок, и откроются баллы, расписание и оплата',
  '',
  '▸ Тренеру группы назначает администратор: напишите ему после первого входа',
  '',
  '▸ Вопросы и предложения пишите администратору клуба или в наш канал: мы читаем каждое сообщение',
  '',
  'Приложение обновляется регулярно, следите за новостями в канале.',
  '',
  'Нажмите кнопку ниже, чтобы открыть приложение.',
].join('\n');

export const HINT = 'Всё находится в приложении. Нажмите кнопку ниже, чтобы открыть его.';

/** @param {object} update  update от Telegram  @param {string} appUrl  адрес Mini App (https) */
export function route(update, appUrl) {
  const openApp = { text: 'Открыть приложение', web_app: { url: appUrl } };
  const msg = update?.message;
  if (msg && msg.chat?.type === 'private' && typeof msg.text === 'string') {
    if (/^\/start(@\w+)?(\s|$)/.test(msg.text)) {
      return [{ method: 'sendMessage', body: { chat_id: msg.chat.id, text: WELCOME, reply_markup: { inline_keyboard: [[{ text: 'Далее ➡️', callback_data: 'next' }]] } } }];
    }
    return [{ method: 'sendMessage', body: { chat_id: msg.chat.id, text: HINT, reply_markup: { inline_keyboard: [[openApp]] } } }];
  }
  const cb = update?.callback_query;
  if (cb && cb.data === 'next' && cb.message?.chat?.type === 'private') {
    return [
      { method: 'answerCallbackQuery', body: { callback_query_id: cb.id } },
      { method: 'sendMessage', body: { chat_id: cb.message.chat.id, text: BEFORE_START, reply_markup: { inline_keyboard: [[{ text: 'Наш канал', url: CHANNEL_URL }], [openApp]] } } },
    ];
  }
  if (cb) return [{ method: 'answerCallbackQuery', body: { callback_query_id: cb.id } }];
  return [];
}
