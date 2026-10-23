// Отправка уведомлений ботом: сборка вызова Bot API и разбор ответа Telegram. Чистые функции, без сети и секретов.

/** @param {{telegram_id: number|string, text: string}} n  @param {string} appUrl  адрес Mini App (https) */
export function buildCall(n, appUrl) {
  return {
    method: 'sendMessage',
    body: {
      chat_id: n.telegram_id,
      text: n.text,
      reply_markup: { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: appUrl } }]] },
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
