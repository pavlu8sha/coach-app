// Запись на тренировку из Telegram (Issue #274). Условия: docs/TELEGRAM_BOOKING_ACCEPTANCE.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBookingData, bookMenuButton, sessionsMenu, childrenMenu, bookCalls, bookingFlow, BOOK_FAIL,
} from '../../supabase/functions/tg-bot/booking-logic.js';

const S = '0b9d3f2e-7a51-4c3e-9f10-2d6b8e4a1c77';
const S2 = '1c0e4a3f-8b62-4d4f-8a21-3e7c9f5b2d88';
const P8 = 'a1b2c3d4';
const P8B = 'e5f6a7b8';
const cb = { id: 'q1', message: { chat: { id: 42 }, message_id: 9, reply_markup: { inline_keyboard: [] } } };

test('разбор данных кнопки: меню, занятие, ребёнок, очередь', () => {
  assert.deepEqual(parseBookingData('bk'), { action: 'menu' });
  assert.deepEqual(parseBookingData(`bs:${S}`), { action: 'session', session: S });
  assert.deepEqual(parseBookingData(`bc:${S}:${P8}`), { action: 'book', session: S, child: P8 });
  assert.deepEqual(parseBookingData(`bw:${S}:${P8}`), { action: 'waitlist', session: S, child: P8 });
});

test('разбор отклоняет чужой, испорченный и пустой формат', () => {
  for (const bad of [
    undefined, null, 42, '', 'bk ', 'bs:', `bs:${S}x`, `bs:${S.toUpperCase()}`,
    `bc:${S}`, `bc:${S}:${P8}:extra`, `bc:${S}:${P8}zz`, `bc:${S}:short`, `bw:${S}:`,
    `r:${S}:y`, `w:${S}`, 'next', `bk:${S}`,
  ]) {
    assert.equal(parseBookingData(bad), null, `должно отклоняться: ${JSON.stringify(bad)}`);
  }
});

test('callback_data укладывается в 64 байта при любых UUID и префиксе ребёнка', () => {
  const longest = [bookMenuButton().callback_data, `bs:${S}`, `bc:${S}:${P8}`, `bw:${S}:${P8}`];
  for (const d of longest) assert.ok(Buffer.byteLength(d, 'utf8') <= 64, d);
});

test('меню: пусто, одно занятие, несколько занятий', () => {
  const none = sessionsMenu([]);
  assert.match(none.text, /нет ближайших/i);
  assert.deepEqual(none.inline_keyboard.flat().map(b => b.callback_data), ['bk']);

  const one = sessionsMenu([{ id: S, label: 'Пт 07.11 19:00 · Индивидуальная · 25 ₾ · мест 2', free: true }]);
  assert.deepEqual(one.inline_keyboard[0], [{ text: 'Пт 07.11 19:00 · Индивидуальная · 25 ₾ · мест 2', callback_data: `bs:${S}` }]);

  const many = sessionsMenu([
    { id: S, label: 'А', free: true },
    { id: S2, label: 'Б', free: false },
  ]);
  assert.deepEqual(many.inline_keyboard.slice(0, 2).map(r => r[0].callback_data), [`bs:${S}`, `bs:${S2}`]);
  assert.match(many.inline_keyboard[1][0].text, /мест нет/);
});

test('меню занятий не больше 10 строк', () => {
  const list = Array.from({ length: 15 }, (_, i) => ({ id: `${i}`.padStart(8, '0') + S.slice(8), label: `L${i}`, free: true }));
  const m = sessionsMenu(list);
  assert.ok(m.inline_keyboard.length <= 11, 'десять занятий и строка «назад»');
});

test('ребёнок: один и несколько детей, у занятия без мест — кнопка очереди', () => {
  const free = childrenMenu(S, true, [{ id8: P8, name: 'Аня' }]);
  assert.deepEqual(free.inline_keyboard[0], [{ text: 'Записать: Аня', callback_data: `bc:${S}:${P8}` }]);

  const two = childrenMenu(S, true, [{ id8: P8, name: 'Аня' }, { id8: P8B, name: 'Боря' }]);
  assert.deepEqual(two.inline_keyboard.map(r => r[0].callback_data), [`bc:${S}:${P8}`, `bc:${S}:${P8B}`]);

  const full = childrenMenu(S, false, [{ id8: P8, name: 'Аня' }]);
  assert.match(full.text, /мест нет/i);
  assert.deepEqual(full.inline_keyboard[0], [{ text: 'Встать в очередь: Аня', callback_data: `bw:${S}:${P8}` }]);
});

test('ребёнок без подходящих условий не получает кнопок', () => {
  const none = childrenMenu(S, true, []);
  assert.deepEqual(none.inline_keyboard, []);
  assert.match(none.text, /нет детей, которых можно записать/i);
});

test('результат записи: успех и повтор убирают кнопки, отказ — нет', () => {
  const ok = bookCalls(cb, 'book', { ok: true, code: 'ok', player: 'Аня', label: 'Пт 07.11 19:00' });
  assert.equal(ok[0].method, 'answerCallbackQuery');
  assert.equal(ok[0].body.callback_query_id, 'q1');
  assert.match(ok[0].body.text, /Запись подтверждена: Аня/);
  assert.equal(ok[1].method, 'editMessageReplyMarkup');
  assert.deepEqual(ok[1].body.reply_markup, { inline_keyboard: [] });

  const again = bookCalls(cb, 'book', { ok: false, code: 'already', player: 'Аня', label: 'Пт 07.11 19:00' });
  assert.match(again[0].body.text, /Уже записаны: Аня/);
  assert.equal(again[1].method, 'editMessageReplyMarkup');

  const full = bookCalls(cb, 'book', { ok: false, code: 'full' });
  assert.equal(full.length, 1);
  assert.equal(full[0].body.text, BOOK_FAIL.full);
  assert.equal(full[0].body.show_alert, true);
});

test('очередь: успех ставит в очередь, ошибка — текст из BOOK_FAIL', () => {
  const ok = bookCalls(cb, 'waitlist', { ok: true, code: 'ok', player: 'Аня', label: 'Пт 07.11 19:00' });
  assert.match(ok[0].body.text, /в очереди: Аня/);
  for (const code of ['closed', 'not_allowed', 'forbidden', 'unknown_user', 'not_found', 'error']) {
    const r = bookCalls(cb, 'book', { ok: false, code });
    assert.equal(r[0].body.text, BOOK_FAIL[code], code);
    assert.equal(r.length, 1, `без правки кнопок: ${code}`);
  }
});

test('неизвестный код результата даёт общий текст, без вызова с пустым текстом', () => {
  const r = bookCalls(cb, 'book', { ok: false, code: 'что-то новое' });
  assert.equal(r[0].body.text, BOOK_FAIL.error);
});

// --- bookingFlow: Telegram ID только из проверенного update, всё остальное решает база ---
const priv = (extra = {}) => ({ id: 'q1', from: { id: 555 }, message: { chat: { id: 555, type: 'private' }, message_id: 9 }, ...extra });
const fakeRpc = (answers, log = []) => async (fn, args) => { log.push({ fn, args }); const a = answers[fn]; return typeof a === 'function' ? a(args) : a; };
const OPTS = { ok: true, sessions: [{ id: S, kind: 'individual', label: 'Пт 07.11 19:00', free: true, children: [{ id8: P8, name: 'Аня' }, { id8: P8B, name: 'Боря' }] }, { id: S2, kind: 'extra', label: 'Сб 08.11', free: false, children: [{ id8: P8, name: 'Аня' }] }] };

test('поток: меню показывает занятия из базы и правит то же сообщение', async () => {
  const log = [];
  const calls = await bookingFlow(priv(), { action: 'menu' }, fakeRpc({ booking_options_by_telegram: OPTS }, log));
  assert.deepEqual(log, [{ fn: 'booking_options_by_telegram', args: { p_telegram_id: 555 } }]);
  assert.deepEqual(calls.map(c => c.method), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(calls[1].body.chat_id, 555);
  assert.deepEqual(calls[1].body.reply_markup.inline_keyboard.map(r => r[0].callback_data), [`bs:${S}`, `bs:${S2}`]);
});

test('поток: выбор занятия — кнопки детей; без мест — кнопки очереди', async () => {
  const rpc = fakeRpc({ booking_options_by_telegram: OPTS });
  const one = await bookingFlow(priv(), { action: 'session', session: S }, rpc);
  assert.deepEqual(one[1].body.reply_markup.inline_keyboard.map(r => r[0].callback_data), [`bc:${S}:${P8}`, `bc:${S}:${P8B}`, 'bk']);
  const full = await bookingFlow(priv(), { action: 'session', session: S2 }, rpc);
  assert.equal(full[1].body.reply_markup.inline_keyboard[0][0].callback_data, `bw:${S2}:${P8}`);
  const gone = await bookingFlow(priv(), { action: 'session', session: '2d1f5b4a-9c73-4e5a-8b32-4f8d0a6c3e99' }, rpc);
  assert.equal(gone[0].body.text, BOOK_FAIL.not_found);
});

test('поток: запись передаёт в базу Telegram ID из from, а не из данных кнопки', async () => {
  const log = [];
  const calls = await bookingFlow(priv(), { action: 'book', session: S, child: P8 }, fakeRpc({ booking_signup_by_telegram: { ok: true, code: 'ok', player: 'Аня', label: 'Пт' } }, log));
  assert.deepEqual(log, [{ fn: 'booking_signup_by_telegram', args: { p_telegram_id: 555, p_session: S, p_child: P8 } }]);
  assert.match(calls[0].body.text, /Запись подтверждена: Аня/);
});

test('поток: очередь только по отдельной кнопке', async () => {
  const log = [];
  const calls = await bookingFlow(priv(), { action: 'waitlist', session: S2, child: P8 }, fakeRpc({ waitlist_join_by_telegram: { ok: true, code: 'ok', player: 'Аня', label: 'Сб' } }, log));
  assert.equal(log.length, 1);
  assert.equal(log[0].fn, 'waitlist_join_by_telegram');
  assert.match(calls[0].body.text, /Вы в очереди: Аня/);
  const menu = await bookingFlow(priv(), { action: 'menu' }, fakeRpc({ booking_options_by_telegram: OPTS }, log));
  assert.equal(log.filter(x => x.fn === 'waitlist_join_by_telegram').length, 1, 'меню и выбор занятия в очередь не ставят');
  assert.equal(menu.length, 2);
});

test('поток: повторный callback идёт в базу снова и получает «уже записаны»', async () => {
  const rpc = fakeRpc({ booking_signup_by_telegram: args => args.n ? null : { ok: false, code: 'already', player: 'Аня', label: 'Пт' } });
  const a = await bookingFlow(priv(), { action: 'book', session: S, child: P8 }, rpc);
  const b = await bookingFlow(priv(), { action: 'book', session: S, child: P8 }, rpc);
  assert.deepEqual(a, b);
  assert.match(a[0].body.text, /Уже записаны: Аня/);
});

test('поток: не личный чат, чужой chat.id или нет from — отказ без обращения к базе', async () => {
  const log = [];
  const rpc = fakeRpc({ booking_options_by_telegram: OPTS, booking_signup_by_telegram: { ok: true } }, log);
  for (const cbq of [
    priv({ message: { chat: { id: -100, type: 'group' }, message_id: 9 } }),
    priv({ message: { chat: { id: 777, type: 'private' }, message_id: 9 } }),
    priv({ from: undefined }),
    priv({ from: { id: '555' } }),
  ]) {
    const calls = await bookingFlow(cbq, { action: 'book', session: S, child: P8 }, rpc);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.text, BOOK_FAIL.forbidden);
  }
  assert.equal(log.length, 0);
});

test('поток: сбой базы (null или исключение) даёт общий текст и не роняет бота', async () => {
  for (const rpc of [async () => null, async () => { throw new Error('boom'); }]) {
    const a = await bookingFlow(priv(), { action: 'book', session: S, child: P8 }, rpc);
    assert.equal(a[0].body.text, BOOK_FAIL.error);
    const m = await bookingFlow(priv(), { action: 'menu' }, rpc);
    assert.equal(m[0].body.text, BOOK_FAIL.error);
  }
  const unknown = await bookingFlow(priv(), { action: 'menu' }, fakeRpc({ booking_options_by_telegram: { ok: false, code: 'unknown_user' } }));
  assert.equal(unknown[0].body.text, BOOK_FAIL.unknown_user);
});
