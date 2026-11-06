// «Занять место» нажатием кнопки в сообщении бота об освободившемся месте (Issue #274, очередь ожидания, миграция 0152).
// Чистые функции: разбор данных кнопки и сборка ответа Telegram. Кто нажал и получил ли место, решает функция базы
// waitlist_claim_by_telegram (та же атомарная проверка, что в приложении).

const DATA = /^w:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** @param {unknown} data  callback_data кнопки  @returns {{waitlist: string} | null} */
export function parseWaitlist(data) {
  const m = typeof data === 'string' ? DATA.exec(data) : null;
  return m ? { waitlist: m[1] } : null;
}

const FAIL = {
  unknown_user: 'Не нашли ваш аккаунт. Откройте приложение и войдите.',
  not_found: 'Этой позиции в очереди уже нет: возможно, место занято или вы вышли из очереди.',
  full: 'Место уже заняли. Вы остаётесь в очереди: когда освободится следующее, пришлём сообщение.',
  closed: 'Занятие уже началось или отменено.',
  not_allowed: 'Запись недоступна. Подробности в приложении.',
  forbidden: 'Нет доступа: вы не привязаны к этому ребёнку.',
};

/**
 * @param {any} cb  callback_query Telegram
 * @param {{waitlist: string}} wl
 * @param {{ok: boolean, code?: string, player?: string, label?: string}} result  ответ waitlist_claim_by_telegram
 */
export function waitlistCalls(cb, wl, result) {
  if (!result?.ok) {
    return [{ method: 'answerCallbackQuery', body: { callback_query_id: cb.id, text: FAIL[result?.code] ?? 'Не получилось занять место. Откройте приложение и попробуйте там.', show_alert: true } }];
  }
  const calls = [{ method: 'answerCallbackQuery', body: { callback_query_id: cb.id, text: `Место за вами: ${result.player}`, show_alert: true } }];
  const kb = cb.message?.reply_markup?.inline_keyboard;
  if (Array.isArray(kb) && cb.message?.chat?.id != null && cb.message?.message_id != null) {
    // убираем кнопку занявшего ребёнка; остальные кнопки (другие дети) и «Открыть приложение» остаются
    const inline_keyboard = kb.filter(row => !(Array.isArray(row) && row.some(b => b?.callback_data === `w:${wl.waitlist}`)));
    calls.push({ method: 'editMessageReplyMarkup', body: { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard } } });
  }
  return calls;
}
