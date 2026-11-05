// Ответ на матч нажатием кнопки в уведомлении бота (Issue #274). Чистые функции: разбор данных кнопки и сборка ответа Telegram.
// Кнопки ставит база (миграция 0137): данные «r:<id приглашения>:y|n». Кто нажал и можно ли отвечать, решает функция базы
// rsvp_answer_by_telegram (та же проверка, что в приложении); здесь только разбор и текст.

const DATA = /^r:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(y|n)$/;

/** @param {unknown} data  callback_data кнопки  @returns {{invitation: string, response: 'yes'|'no'} | null} */
export function parseRsvp(data) {
  const m = typeof data === 'string' ? DATA.exec(data) : null;
  return m ? { invitation: m[1], response: m[2] === 'y' ? 'yes' : 'no' } : null;
}

const WORD = { yes: 'Будет', no: 'Не будет' };
const FAIL = {
  unknown_user: 'Не нашли ваш аккаунт. Откройте приложение и войдите.',
  not_found: 'Это приглашение уже недоступно.',
  forbidden: 'Нет доступа: вы не привязаны к этому ребёнку.',
  closed: 'Приём ответов закрыт или матч отменён. Подробности в приложении.',
  bad_request: 'Не удалось записать ответ.',
};

/**
 * @param {any} cb  callback_query Telegram
 * @param {{invitation: string, response: 'yes'|'no'}} rsvp
 * @param {{ok: boolean, code?: string, player?: string}} result  ответ rsvp_answer_by_telegram
 */
export function rsvpCalls(cb, rsvp, result) {
  if (!result?.ok) {
    return [{ method: 'answerCallbackQuery', body: { callback_query_id: cb.id, text: FAIL[result?.code] ?? 'Не получилось записать ответ. Попробуйте позже или откройте приложение.', show_alert: true } }];
  }
  const calls = [{ method: 'answerCallbackQuery', body: { callback_query_id: cb.id, text: `Записано: ${result.player} — ${WORD[rsvp.response]}` } }];
  const kb = cb.message?.reply_markup?.inline_keyboard;
  if (Array.isArray(kb) && cb.message?.chat?.id != null && cb.message?.message_id != null) {
    // у ответившего ребёнка отмечаем выбранную кнопку; обе кнопки остаются, ответ можно изменить
    const mark = t => t.replace(/^✅ /, '');
    const inline_keyboard = kb.map(row => (Array.isArray(row) && row.some(b => typeof b?.callback_data === 'string' && b.callback_data.startsWith(`r:${rsvp.invitation}:`))
      ? row.map(b => (b.callback_data === `r:${rsvp.invitation}:${rsvp.response === 'yes' ? 'y' : 'n'}` ? { ...b, text: `✅ ${mark(b.text)}` } : { ...b, text: mark(b.text) }))
      : row));
    calls.push({ method: 'editMessageReplyMarkup', body: { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard } } });
  }
  return calls;
}
