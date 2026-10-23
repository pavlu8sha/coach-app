import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInitData, signInitData } from '../../supabase/functions/tg-auth/init-data.js';

const TOKEN = '123456:TEST_TOKEN_NOT_REAL';
const now = 1_800_000_000;
const fields = (o = {}) => ({ auth_date: String(now - 60), query_id: 'AAH', user: JSON.stringify({ id: 42, first_name: 'Ivan' }), ...o });

test('верная подпись проходит', async () => {
  const r = await validateInitData(await signInitData(fields(), TOKEN), TOKEN, { now });
  assert.equal(r.ok, true); assert.equal(r.user.id, 42);
});
test('чужой токен бота', async () => {
  assert.equal((await validateInitData(await signInitData(fields(), TOKEN), 'x:y', { now })).reason, 'bad_hash');
});
test('подмена поля после подписи', async () => {
  const s = (await signInitData(fields(), TOKEN)).replace('Ivan', 'Evil');
  assert.equal((await validateInitData(s, TOKEN, { now })).reason, 'bad_hash');
});
test('подмена id пользователя', async () => {
  const s = await signInitData(fields(), TOKEN);
  const p = new URLSearchParams(s); p.set('user', JSON.stringify({ id: 1, first_name: 'Ivan' }));
  assert.equal((await validateInitData(p.toString(), TOKEN, { now })).reason, 'bad_hash');
});
test('просроченная подпись', async () => {
  assert.equal((await validateInitData(await signInitData(fields({ auth_date: String(now - 7200) }), TOKEN), TOKEN, { now })).reason, 'expired');
});
test('подпись из будущего', async () => {
  assert.equal((await validateInitData(await signInitData(fields({ auth_date: String(now + 3600) }), TOKEN), TOKEN, { now })).reason, 'from_future');
});
test('нет hash, пустая строка, нет токена', async () => {
  assert.equal((await validateInitData('auth_date=1', TOKEN, { now })).reason, 'no_hash');
  assert.equal((await validateInitData('', TOKEN, { now })).reason, 'empty');
  assert.equal((await validateInitData('a=b&hash=00', '', { now })).reason, 'empty');
});
test('нет пользователя в подписанных данных', async () => {
  const f = fields(); delete f.user;
  assert.equal((await validateInitData(await signInitData(f, TOKEN), TOKEN, { now })).reason, 'no_user');
});
test('согласованность с ранее проверенной реализацией (Node crypto)', async () => {
  const { createHmac } = await import('node:crypto');
  const f = fields(), dcs = Object.entries(f).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const r = await validateInitData(new URLSearchParams({ ...f, hash }).toString(), TOKEN, { now });
  assert.equal(r.ok, true);
});
