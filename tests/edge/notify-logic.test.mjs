import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCall, classify } from '../../supabase/functions/tg-notify/notify-logic.js';

test('сообщение уходит в нужный чат с кнопкой «Открыть приложение»', () => {
  const c = buildCall({ telegram_id: 123, text: 'Привет' }, 'https://app.example/');
  assert.equal(c.method, 'sendMessage');
  assert.equal(c.body.chat_id, 123);
  assert.equal(c.body.text, 'Привет');
  assert.deepEqual(c.body.reply_markup.inline_keyboard[0][0], { text: 'Открыть приложение', web_app: { url: 'https://app.example/' } });
});

test('успешный ответ', () => {
  assert.deepEqual(classify(200), { ok: true, giveUp: false, stop: false, error: null });
});

test('бот заблокирован или чат неизвестен: больше не пытаться', () => {
  assert.equal(classify(403, '{"description":"Forbidden: bot was blocked by the user"}').giveUp, true);
  assert.equal(classify(400, '{"description":"Bad Request: chat not found"}').giveUp, true);
  assert.equal(classify(400, '{"description":"Bad Request: user is deactivated"}').giveUp, true);
});

test('лимит Telegram: притормозить, но не закрывать сообщение', () => {
  const r = classify(429, '{"parameters":{"retry_after":5}}');
  assert.deepEqual([r.ok, r.giveUp, r.stop], [false, false, true]);
});

test('прочие ошибки: повторить позже', () => {
  assert.deepEqual([classify(500, 'oops').ok, classify(500, 'oops').giveUp, classify(500, 'oops').stop], [false, false, false]);
  assert.equal(classify(400, 'Bad Request: message text is empty').giveUp, false);
});

test('текст ошибки обрезается', () => {
  assert.ok(classify(500, 'x'.repeat(1000)).error.length < 260);
});
