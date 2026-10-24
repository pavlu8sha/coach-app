import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadStep, withLeadButton, CONSENT, WANT_BUTTON } from '../../supabase/functions/tg-bot/lead-logic.js';
import { BEFORE_START } from '../../supabase/functions/tg-bot/bot-logic.js';

const priv = { id: 7, type: 'private' };
const from = { id: 7, first_name: 'Анна', last_name: 'Петрова', username: 'anna' };
const Y = 2026;
const msg = (text, extra = {}) => ({ message: { chat: priv, from, text, ...extra } });
const cb = (data) => ({ callback_query: { id: 'q', data, from, message: { chat: priv } } });

test('кнопка «Хочу в KickStart» добавляется только к сообщению «Перед началом»', () => {
  const calls = [{ method: 'sendMessage', body: { chat_id: 7, text: BEFORE_START, reply_markup: { inline_keyboard: [[{ text: 'Наш канал', url: 'x' }]] } } }, { method: 'sendMessage', body: { chat_id: 7, text: 'другое', reply_markup: { inline_keyboard: [[]] } } }];
  const out = withLeadButton(calls, BEFORE_START);
  assert.deepEqual(out[0].body.reply_markup.inline_keyboard.at(-1), [WANT_BUTTON]);
  assert.equal(out[1].body.reply_markup.inline_keyboard.length, 1);
});

test('«Хочу»: сначала согласие, черновик на шаге consent с именем родителя', () => {
  const r = leadStep(cb('want'), null, Y);
  assert.equal(r.calls[1].body.text, CONSENT);
  assert.equal(r.draft.step, 'consent');
  assert.equal(r.draft.parent_name, 'Анна Петрова');
  assert.equal(r.draft.username, 'anna');
});

test('без согласия данные не принимаются: текст без черновика не относится к диалогу', () => {
  assert.equal(leadStep(msg('Иван Петров'), null, Y), null);
  const r = leadStep(msg('Иван Петров'), { step: 'consent' }, Y);
  assert.equal(r.draft.step, 'consent');
  assert.match(r.calls[0].body.text, /Отправить|Отмена/);
});

test('полный путь: согласие → имя → год → телефон → подтверждение → заявка', () => {
  let d = leadStep(cb('lead_yes'), { step: 'consent', parent_name: 'Анна', username: 'anna' }, Y).draft;
  assert.equal(d.step, 'child');
  d = leadStep(msg('  Иван   Петров '), d, Y).draft;
  assert.deepEqual([d.step, d.child_name], ['year', 'Иван Петров']);
  d = leadStep(msg('2017'), d, Y).draft;
  assert.deepEqual([d.step, d.birth_year], ['phone', 2017]);
  const p = leadStep(msg('+995 555 12 34 56'), d, Y);
  assert.equal(p.draft.step, 'confirm');
  assert.match(p.calls[1].body.text, /Иван Петров[\s\S]*2017[\s\S]*\+995 555 12 34 56/);
  const s = leadStep(cb('lead_send'), p.draft, Y);
  assert.equal(s.draft, null);
  assert.deepEqual(s.submit, { tg: 7, parent: 'Анна', uname: 'anna', child: 'Иван Петров', byear: 2017, phone: '+995 555 12 34 56' });
});

test('проверки ввода: имя, год, телефон', () => {
  assert.equal(leadStep(msg('1'), { step: 'child' }, Y).draft.step, 'child');
  assert.equal(leadStep(msg('<script>'), { step: 'child' }, Y).draft.step, 'child');
  for (const bad of ['1990', '2025', 'abc', '20177']) assert.equal(leadStep(msg(bad), { step: 'year' }, Y).draft.step, 'year', bad);
  for (const bad of ['abc', '12', '+++']) assert.equal(leadStep(msg(bad), { step: 'phone' }, Y).draft.step, 'phone', bad);
});

test('телефон из контакта принимается только свой', () => {
  const own = leadStep(msg(undefined, { contact: { phone_number: '995555123456', user_id: 7 } }), { step: 'phone', child_name: 'И', birth_year: 2017 }, Y);
  assert.equal(own.draft.phone, '+995555123456');
  const foreign = leadStep(msg(undefined, { contact: { phone_number: '995555123456', user_id: 99 } }), { step: 'phone' }, Y);
  assert.equal(foreign.draft.step, 'phone');
});

test('отмена и /start сбрасывают черновик', () => {
  assert.equal(leadStep(cb('lead_cancel'), { step: 'child' }, Y).draft, null);
  assert.equal(leadStep(msg('/start'), { step: 'year' }, Y).draft, null);
  assert.equal(leadStep(msg('/cancel'), { step: 'year' }, Y).draft, null);
});

test('кнопка отправки без подтверждённого черновика не создаёт заявку', () => {
  const r = leadStep(cb('lead_send'), { step: 'child' }, Y);
  assert.equal(r.submit, undefined);
  assert.equal(r.draft, null);
});

test('группы и чужие кнопки не относятся к диалогу', () => {
  assert.equal(leadStep({ message: { chat: { id: 1, type: 'group' }, text: 'hi' } }, { step: 'child' }, Y), null);
  assert.equal(leadStep(cb('next'), null, Y), null);
});
