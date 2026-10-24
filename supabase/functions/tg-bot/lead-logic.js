// Диалог «Хочу в KickStart»: согласие → имя ребёнка → год рождения → телефон родителя → подтверждение → заявка.
// Чистая функция: принимает update Telegram и сохранённый черновик, возвращает вызовы Bot API и новое состояние черновика.
// Сеть и база — в index.ts. Включается переменной LEADS_ENABLED=1 (по умолчанию выключено: см. README.md).

export const WANT_BUTTON = { text: 'Хочу в KickStart ⚽', callback_data: 'want' };

export const CONSENT = [
  'Чтобы записать ребёнка в клуб, нам нужны: имя ребёнка, год его рождения и ваш телефон.',
  '',
  'Эти данные увидит только администратор клуба. Мы используем их, чтобы связаться с вами по записи, и удалим по вашей просьбе (напишите администратору).',
  '',
  'Нажимая «Согласен(на)», вы разрешаете обработку этих данных.',
].join('\n');

const kb = rows => ({ inline_keyboard: rows });
const send = (chat, text, reply_markup) => ({ method: 'sendMessage', body: { chat_id: chat, text, ...(reply_markup ? { reply_markup } : {}) } });
const answer = id => ({ method: 'answerCallbackQuery', body: { callback_query_id: id } });
const cancelRow = [{ text: 'Отмена', callback_data: 'lead_cancel' }];
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{1,78}[\p{L}\p{M}.]$/u;
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

export function buildDraft(from) {
  return { parent_name: [from?.first_name, from?.last_name].filter(Boolean).join(' ') || null, username: from?.username ?? null };
}

/** Добавляет кнопку «Хочу в KickStart» к сообщению «Перед началом» (когда диалог включён). */
export function withLeadButton(calls, beforeStartText) {
  return calls.map(c => (c.method === 'sendMessage' && c.body.text === beforeStartText && c.body.reply_markup?.inline_keyboard
    ? { ...c, body: { ...c.body, reply_markup: { inline_keyboard: [...c.body.reply_markup.inline_keyboard, [WANT_BUTTON]] } } }
    : c));
}

/**
 * @param {object} update  update от Telegram
 * @param {object|null} draft  сохранённый черновик ({step, child_name, birth_year, phone, parent_name, username}) или null
 * @param {number} [year]  текущий год (для проверки года рождения)
 * @returns {null | {calls: object[], draft: object|null, submit?: object}}  null — обновление не относится к диалогу
 */
export function leadStep(update, draft, year = new Date().getFullYear()) {
  const cb = update?.callback_query;
  if (cb && cb.message?.chat?.type === 'private') {
    const chat = cb.message.chat.id;
    if (cb.data === 'want') {
      return { calls: [answer(cb.id), send(chat, CONSENT, kb([[{ text: 'Согласен(на)', callback_data: 'lead_yes' }], cancelRow]))], draft: { ...buildDraft(cb.from), step: 'consent' } };
    }
    if (cb.data === 'lead_cancel') {
      return { calls: [answer(cb.id), send(chat, 'Хорошо, ничего не сохранили. Если захотите записаться, нажмите «Хочу в KickStart» снова.')], draft: null };
    }
    if (cb.data === 'lead_yes' && draft?.step === 'consent') {
      return { calls: [answer(cb.id), send(chat, 'Как зовут ребёнка? Напишите имя и фамилию.', kb([cancelRow]))], draft: { ...draft, step: 'child' } };
    }
    if (cb.data === 'lead_send' && draft?.step === 'confirm') {
      return {
        calls: [answer(cb.id), send(chat, 'Спасибо! Заявка отправлена, администратор свяжется с вами.')],
        draft: null,
        submit: { tg: cb.from?.id ?? chat, parent: draft.parent_name, uname: draft.username, child: draft.child_name, byear: draft.birth_year, phone: draft.phone },
      };
    }
    if (cb.data === 'lead_yes' || cb.data === 'lead_send') return { calls: [answer(cb.id), send(chat, 'Эта кнопка уже не действует. Нажмите «Хочу в KickStart» и начните заново.')], draft: null };
    return null;
  }

  const msg = update?.message;
  if (!msg || msg.chat?.type !== 'private' || !draft) return null;
  const chat = msg.chat.id;
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  if (/^\/(start|cancel)(@\w+)?(\s|$)/.test(text)) return { calls: [send(chat, 'Заявку отменили, ничего не сохранили.', { remove_keyboard: true })], draft: null };

  if (draft.step === 'child') {
    if (!NAME_RE.test(text)) return { calls: [send(chat, 'Напишите имя и фамилию ребёнка буквами, например «Иван Петров».', kb([cancelRow]))], draft };
    return { calls: [send(chat, 'Какой год рождения у ребёнка? Например, 2017.', kb([cancelRow]))], draft: { ...draft, step: 'year', child_name: text.replace(/\s+/g, ' ') } };
  }
  if (draft.step === 'year') {
    const y = /^\d{4}$/.test(text) ? Number(text) : 0;
    if (y < year - 18 || y > year - 2) return { calls: [send(chat, `Напишите год рождения четырьмя цифрами, от ${year - 18} до ${year - 2}.`, kb([cancelRow]))], draft };
    return {
      calls: [send(chat, 'Оставьте телефон для связи: нажмите кнопку или напишите номер.', { keyboard: [[{ text: 'Отправить мой номер', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true })],
      draft: { ...draft, step: 'phone', birth_year: y },
    };
  }
  if (draft.step === 'phone') {
    const contact = msg.contact && msg.contact.user_id === msg.from?.id ? String(msg.contact.phone_number || '') : '';
    const phone = contact ? (contact.startsWith('+') ? contact : '+' + contact) : text;
    if (!PHONE_RE.test(phone)) return { calls: [send(chat, 'Не получилось разобрать номер. Напишите его в виде +995 555 12 34 56 или нажмите кнопку.')], draft };
    return {
      calls: [
        send(chat, 'Проверьте заявку:', { remove_keyboard: true }),
        send(chat, `Ребёнок: ${draft.child_name}\nГод рождения: ${draft.birth_year}\nТелефон: ${phone}`, kb([[{ text: 'Отправить', callback_data: 'lead_send' }], cancelRow])),
      ],
      draft: { ...draft, step: 'confirm', phone },
    };
  }
  return { calls: [send(chat, 'Нажмите «Отправить» под заявкой или «Отмена».')], draft };
}
