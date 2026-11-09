// Запись на тренировку из бота (Issue #274, миграция 0158). Чистые функции: разбор данных кнопок, меню и ответы Telegram.
// Кто нажал, какой ребёнок и можно ли записать, решает база (booking_signup_by_telegram / waitlist_join_by_telegram):
// здесь только показ. callback_data не содержит ни пользователя, ни клуба; ребёнок задан первыми 8 знаками id и проверяется на сервере.
// Условия: docs/TELEGRAM_BOOKING_ACCEPTANCE.md.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SESSION = new RegExp(`^bs:(${UUID})$`);
const BOOK = new RegExp(`^bc:(${UUID}):([0-9a-f]{8})$`);
const WAIT = new RegExp(`^bw:(${UUID}):([0-9a-f]{8})$`);
const MAX_SESSIONS = 10;
const money = p => (p == null || Number.isNaN(Number(p)) ? '' : ` · ${Number(p)} ₾`);

/** @param {unknown} data  callback_data кнопки */
export function parseBookingData(data) {
  if (typeof data !== 'string') return null;
  if (data === 'bk') return { action: 'menu' };
  let m = SESSION.exec(data);
  if (m) return { action: 'session', session: m[1] };
  m = BOOK.exec(data);
  if (m) return { action: 'book', session: m[1], child: m[2] };
  m = WAIT.exec(data);
  if (m) return { action: 'waitlist', session: m[1], child: m[2] };
  return null;
}

export const bookMenuButton = () => ({ text: 'Записаться на тренировку', callback_data: 'bk' });

/** @param {{id: string, label: string, free: boolean, price?: number|null}[]} sessions */
export function sessionsMenu(sessions) {
  if (!sessions.length) {
    return {
      text: 'Сейчас нет ближайших занятий, на которые можно записать вашего ребёнка. Загляните позже или откройте приложение.',
      inline_keyboard: [[{ text: 'Обновить', callback_data: 'bk' }]],
    };
  }
  const rows = sessions.slice(0, MAX_SESSIONS).map(s => [{ text: `${s.label}${money(s.price)}${s.free ? '' : ' · мест нет'}`, callback_data: `bs:${s.id}` }]);
  return { text: 'Выберите занятие:', inline_keyboard: rows };
}

/** @param {string} session  @param {boolean} free  @param {{id8: string, name: string}[]} children  @param {number|null} [price] цена показывается до записи */
export function childrenMenu(session, free, children, price) {
  if (!children.length) return { text: 'Нет детей, которых можно записать на это занятие.', inline_keyboard: [] };
  const rows = children.map(c => [free
    ? { text: `Записать: ${c.name}`, callback_data: `bc:${session}:${c.id8}` }
    : { text: `Встать в очередь: ${c.name}`, callback_data: `bw:${session}:${c.id8}` }]);
  const cost = price == null || Number.isNaN(Number(price)) ? '' : ` Стоимость: ${Number(price)} ₾.`;
  return { text: free ? `Кого записать?${cost} Можно записать нескольких детей по очереди.` : `Мест нет.${cost} Можно встать в очередь: когда место освободится, придёт сообщение. Кого поставить?`, inline_keyboard: rows };
}

export const BOOK_FAIL = {
  full: 'Мест нет.',
  free: 'Есть свободные места: запишитесь на занятие, очередь не нужна.',
  closed: 'Занятие уже началось или отменено.',
  not_allowed: 'Запись на это занятие для ребёнка недоступна. Подробности в приложении.',
  forbidden: 'Нет доступа: вы не привязаны к этому ребёнку.',
  unknown_user: 'Не нашли ваш аккаунт. Откройте приложение и войдите.',
  not_found: 'Этого занятия уже нет.',
  error: 'Не получилось записать. Попробуйте позже или откройте приложение.',
};

/**
 * @param {any} cb  callback_query Telegram
 * @param {'book'|'waitlist'} kind
 * @param {{ok: boolean, code?: string, player?: string, label?: string}} result  ответ функции базы
 */
export function bookCalls(cb, kind, result) {
  const answer = (text, alert) => ({ method: 'answerCallbackQuery', body: { callback_query_id: cb.id, text, ...(alert ? { show_alert: true } : {}) } });
  const done = text => {
    const calls = [answer(text, true)];
    if (cb.message?.chat?.id != null && cb.message?.message_id != null) {
      // убираем кнопку только этого ребёнка: остальных детей семьи можно записать следом
      const kb = cb.message.reply_markup?.inline_keyboard;
      const inline_keyboard = Array.isArray(kb) ? kb.filter(row => !(Array.isArray(row) && row.some(b => b?.callback_data === cb.data))) : [];
      calls.push({ method: 'editMessageReplyMarkup', body: { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard } } });
    }
    return calls;
  };
  const what = [result?.player, result?.label].filter(Boolean).join(' — ');
  const warn = Array.isArray(result?.conflicts) && result.conflicts.length ? `\n⚠️ В это время у ребёнка также: ${result.conflicts.join('; ')}. Запись сохранена.` : '';
  if (result?.ok) return done(kind === 'waitlist' ? `Вы в очереди: ${what}` : `Запись подтверждена: ${what}${warn}`);
  if (result?.code === 'already') return done(`Уже записаны: ${what}`);
  return [answer(BOOK_FAIL[result?.code] ?? BOOK_FAIL.error, true)];
}

/**
 * Одно нажатие кнопки записи → вызовы Bot API. Telegram ID берётся только из callback_query.from (проверенный update),
 * ничего о пользователе, ребёнке и клубе из callback_data не доверяется: ребёнка и занятие проверяет база.
 * @param {any} cb  callback_query Telegram
 * @param {ReturnType<typeof parseBookingData>} bk  разобранные данные кнопки (не null)
 * @param {(fn: string, args: object) => Promise<any>} rpc  вызов функции базы; при сбое может вернуть null
 */
export async function bookingFlow(cb, bk, rpc) {
  const fail = code => [{ method: 'answerCallbackQuery', body: { callback_query_id: cb.id, text: BOOK_FAIL[code] ?? BOOK_FAIL.error, show_alert: true } }];
  const tg = cb?.from?.id;
  const chat = cb?.message?.chat;
  // имена детей показываем только в личном чате с самим родителем
  if (!bk || typeof tg !== 'number' || chat?.type !== 'private' || chat?.id !== tg || cb.message?.message_id == null) return fail('forbidden');
  const call = async (fn, extra = {}) => {
    try { return (await rpc(fn, { p_telegram_id: tg, ...extra })) ?? { ok: false, code: 'error' }; } catch { return { ok: false, code: 'error' }; }
  };
  const show = (menu, back) => [
    { method: 'answerCallbackQuery', body: { callback_query_id: cb.id } },
    { method: 'editMessageText', body: { chat_id: chat.id, message_id: cb.message.message_id, text: menu.text, reply_markup: { inline_keyboard: back ? [...menu.inline_keyboard, [{ text: '← К занятиям', callback_data: 'bk' }]] : menu.inline_keyboard } } },
  ];
  if (bk.action === 'book') return bookCalls(cb, 'book', await call('booking_signup_by_telegram', { p_session: bk.session, p_child: bk.child }));
  if (bk.action === 'waitlist') return bookCalls(cb, 'waitlist', await call('waitlist_join_by_telegram', { p_session: bk.session, p_child: bk.child }));
  const opts = await call('booking_options_by_telegram');
  if (!opts.ok) return fail(opts.code);
  const sessions = Array.isArray(opts.sessions) ? opts.sessions : [];
  if (bk.action === 'menu') return show(sessionsMenu(sessions), false);
  const s = sessions.find(x => x.id === bk.session);
  if (!s) return fail('not_found');
  return show(childrenMenu(s.id, s.free, s.children ?? [], s.price), true);
}
