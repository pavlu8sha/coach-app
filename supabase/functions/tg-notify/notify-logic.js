// Отправка уведомлений ботом: сборка вызова Bot API и разбор ответа Telegram. Чистые функции, без сети и секретов.

/**
 * @param {{telegram_id: number|string, text: string, buttons?: {text: string, data: string}[][] | null}} n
 * @param {string} appUrl  адрес Mini App (https)
 * buttons — кнопки ответа (например, «Будет» / «Не будет» у матча, миграция 0137): строки кнопок над «Открыть приложение»
 */
export function buildCall(n, appUrl) {
  const rows = Array.isArray(n.buttons)
    ? n.buttons
        .filter(r => Array.isArray(r) && r.length > 0)
        .map(r => r.filter(b => b && typeof b.text === 'string' && typeof b.data === 'string' && b.data.length <= 64).map(b => ({ text: b.text, callback_data: b.data })))
        .filter(r => r.length > 0)
    : [];
  return {
    method: 'sendMessage',
    body: {
      chat_id: n.telegram_id,
      text: n.text,
      reply_markup: { inline_keyboard: [...rows, [{ text: 'Открыть приложение', web_app: { url: appUrl } }]] },
    },
  };
}

/**
 * Что делать после ответа Bot API.
 * @param {number} status  HTTP-статус ответа
 * @param {string} bodyText  тело ответа (для описания ошибки)
 * @returns {{ok: boolean, giveUp: boolean, stop: boolean, error: string | null}}
 *   giveUp — больше не пытаться (бот заблокирован или пользователь не начинал диалог); stop — Telegram просит притормозить (429)
 */
export function classify(status, bodyText = '') {
  const text = String(bodyText).slice(0, 200);
  if (status >= 200 && status < 300) return { ok: true, giveUp: false, stop: false, error: null };
  if (status === 429) return { ok: false, giveUp: false, stop: true, error: `429 ${text}` };
  // 403: пользователь заблокировал бота или не запускал его; 400 «chat not found»: бот не знает такого чата
  if (status === 403 || (status === 400 && /chat not found|user is deactivated/i.test(text))) return { ok: false, giveUp: true, stop: false, error: `${status} ${text}` };
  return { ok: false, giveUp: false, stop: false, error: `${status} ${text}` };
}
