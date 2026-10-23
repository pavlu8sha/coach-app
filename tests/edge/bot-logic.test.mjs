import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, CHANNEL_URL, WELCOME, BEFORE_START } from '../../supabase/functions/tg-bot/bot-logic.js';

const APP = 'https://example.pages.dev/';
const priv = { id: 7, type: 'private' };

test('/start: приветствие и кнопка «Далее»', () => {
  const [c] = route({ message: { chat: priv, text: '/start' } }, APP);
  assert.equal(c.method, 'sendMessage');
  assert.equal(c.body.chat_id, 7);
  assert.equal(c.body.text, WELCOME);
  assert.deepEqual(c.body.reply_markup.inline_keyboard, [[{ text: 'Далее ➡️', callback_data: 'next' }]]);
});
test('/start с параметром и с именем бота', () => {
  assert.equal(route({ message: { chat: priv, text: '/start abc' } }, APP)[0].body.text, WELCOME);
  assert.equal(route({ message: { chat: priv, text: '/start@kicksapp_bot' } }, APP)[0].body.text, WELCOME);
});
test('«Далее»: ответ на нажатие и второе сообщение с каналом и приложением', () => {
  const calls = route({ callback_query: { id: 'q1', data: 'next', message: { chat: priv } } }, APP);
  assert.equal(calls[0].method, 'answerCallbackQuery');
  assert.equal(calls[0].body.callback_query_id, 'q1');
  assert.equal(calls[1].body.text, BEFORE_START);
  const rows = calls[1].body.reply_markup.inline_keyboard;
  assert.equal(rows[0][0].url, CHANNEL_URL);
  assert.deepEqual(rows[1][0].web_app, { url: APP });
});
test('другой текст: подсказка с кнопкой приложения', () => {
  const [c] = route({ message: { chat: priv, text: 'привет' } }, APP);
  assert.deepEqual(c.body.reply_markup.inline_keyboard[0][0].web_app, { url: APP });
});
test('группы и прочие обновления игнорируются', () => {
  assert.deepEqual(route({ message: { chat: { id: 1, type: 'group' }, text: '/start' } }, APP), []);
  assert.deepEqual(route({ edited_message: {} }, APP), []);
  assert.deepEqual(route({}, APP), []);
});
test('чужая callback-кнопка только снимает «часики»', () => {
  const calls = route({ callback_query: { id: 'q2', data: 'other', message: { chat: priv } } }, APP);
  assert.deepEqual(calls, [{ method: 'answerCallbackQuery', body: { callback_query_id: 'q2' } }]);
});
test('тексты помещаются в лимит Telegram (4096)', () => {
  assert.ok(WELCOME.length < 4096 && BEFORE_START.length < 4096);
});
