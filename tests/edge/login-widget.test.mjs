import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLoginWidget, signLoginWidget } from '../../supabase/functions/tg-login/login-widget.js';

const TOKEN = '123456:TEST-token';
const NOW = 1_800_000_000;
const base = { id: 777, first_name: 'Анна', last_name: 'Петрова', username: 'anna_p', photo_url: 'https://t.me/i/userpic/320/x.jpg', auth_date: NOW - 60 };

test('верная подпись принимается, пользователь разобран', async () => {
  const r = await validateLoginWidget(await signLoginWidget(base, TOKEN), TOKEN, { now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(r.user, { id: 777, first_name: 'Анна', last_name: 'Петрова', username: 'anna_p' });
  assert.equal(r.authDate, NOW - 60);
});

test('поле photo_url входит в подпись, а необязательные поля можно не присылать', async () => {
  const noPhoto = { id: 5, first_name: 'Иван', auth_date: NOW };
  assert.equal((await validateLoginWidget(await signLoginWidget(noPhoto, TOKEN), TOKEN, { now: NOW })).ok, true);
  const signed = await signLoginWidget(base, TOKEN);
  const r = await validateLoginWidget({ ...signed, photo_url: 'https://evil.example/x.jpg' }, TOKEN, { now: NOW });
  assert.deepEqual(r, { ok: false, reason: 'bad_hash' });
});

test('подделка идентификатора и чужой токен отклоняются', async () => {
  const signed = await signLoginWidget(base, TOKEN);
  assert.deepEqual(await validateLoginWidget({ ...signed, id: 1 }, TOKEN, { now: NOW }), { ok: false, reason: 'bad_hash' });
  assert.deepEqual(await validateLoginWidget(signed, 'other:token', { now: NOW }), { ok: false, reason: 'bad_hash' });
});

test('подпись Mini App (initData) не подходит как подпись виджета', async () => {
  // у initData другой секрет; поле с той же строкой подписи виджет не примет
  const signed = await signLoginWidget(base, TOKEN);
  const swapped = { ...signed, hash: 'a'.repeat(64) };
  assert.equal((await validateLoginWidget(swapped, TOKEN, { now: NOW })).ok, false);
});

test('старая и «будущая» подпись отклоняются', async () => {
  assert.deepEqual(await validateLoginWidget(await signLoginWidget({ ...base, auth_date: NOW - 7200 }, TOKEN), TOKEN, { now: NOW }), { ok: false, reason: 'expired' });
  assert.deepEqual(await validateLoginWidget(await signLoginWidget({ ...base, auth_date: NOW + 3600 }, TOKEN), TOKEN, { now: NOW }), { ok: false, reason: 'from_future' });
});

test('пустые и неполные данные отклоняются', async () => {
  assert.deepEqual(await validateLoginWidget(null, TOKEN), { ok: false, reason: 'empty' });
  assert.deepEqual(await validateLoginWidget(base, ''), { ok: false, reason: 'empty' });
  assert.deepEqual(await validateLoginWidget(base, TOKEN), { ok: false, reason: 'no_hash' });
  assert.deepEqual(await validateLoginWidget({ ...base, hash: 'x', nested: { a: 1 } }, TOKEN), { ok: false, reason: 'bad_field' });
  const noId = await signLoginWidget({ first_name: 'X', auth_date: NOW }, TOKEN);
  assert.deepEqual(await validateLoginWidget(noId, TOKEN, { now: NOW }), { ok: false, reason: 'no_user' });
});
