import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTgUsername } from '../../supabase/functions/tg-auth/username.js';

test('ник нормализуется: без @ и пробелов', () => {
  assert.equal(normalizeTgUsername('  @Mama_One '), 'Mama_One');
  assert.equal(normalizeTgUsername('Papa24'), 'Papa24');
});
test('неверный формат или отсутствие ника дают null (прежний ник очищается)', () => {
  for (const bad of [undefined, null, '', 'abc', '1abcde', 'a b cd', 'x'.repeat(33), 'ник_кириллица', 'a-b-c-d'])
    assert.equal(normalizeTgUsername(bad), null, String(bad));
});

// Серверный путь записи ника (режим username_only в tg-auth): подпись, адресация строки, подмена тела запроса.
import { handleUsernameOnly } from '../../supabase/functions/tg-auth/username.js';
import { signInitData } from '../../supabase/functions/tg-auth/init-data.js';

const TOKEN = '123456:TEST_TOKEN_NOT_REAL';
const NOW = 1_800_000_000;
const signed = (user, o = {}) => signInitData({ auth_date: String(NOW - 60), query_id: 'AAH', user: JSON.stringify(user), ...o }, TOKEN);
// заглушка admin-клиента: таблица users в памяти, update(...).eq(...).select(...) как в supabase-js
function fakeAdmin(rows) {
  const calls = [];
  return {
    calls,
    from: () => ({
      update: patch => ({
        eq: (col, val) => ({
          select: async () => {
            calls.push({ patch, col, val });
            const hit = rows.filter(r => r[col] === val);
            hit.forEach(r => Object.assign(r, patch));
            return { data: hit.map(r => ({ id: r.id })), error: null };
          },
        }),
      }),
    }),
  };
}
const users = () => [{ id: 'u42', telegram_id: 42, telegram_username: null }, { id: 'u7', telegram_id: 7, telegram_username: 'Other_Nick' }];
const run = (initData, admin, extra = {}) => handleUsernameOnly({ initData, botToken: TOKEN, admin, hit: async () => true, now: NOW, ...extra });

test('верная подпись: сохраняется ник именно Telegram ID из подписанного initData, чужая строка не тронута', async () => {
  const rows = users();
  const r = await run(await signed({ id: 42, first_name: 'Ivan', username: '@Mama_One' }), fakeAdmin(rows));
  assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.equal(rows[0].telegram_username, 'Mama_One');
  assert.equal(rows[1].telegram_username, 'Other_Nick');
});
test('запись адресуется по telegram_id из подписи, а не по полям, присланным отдельно', async () => {
  const rows = users();
  const admin = fakeAdmin(rows);
  // подмена: в initData после подписи меняем user (id и username), подпись перестаёт сходиться
  const p = new URLSearchParams(await signed({ id: 42, username: 'Mama_One' }));
  p.set('user', JSON.stringify({ id: 7, username: 'Hacker_Nick' }));
  const r = await run(p.toString(), admin);
  assert.equal(r.status, 401);
  assert.equal(admin.calls.length, 0);
  assert.equal(rows[1].telegram_username, 'Other_Nick');
});
test('username в теле запроса (вне initData) на запись не влияет', async () => {
  const rows = users();
  const admin = fakeAdmin(rows);
  const r = await run(await signed({ id: 42, username: 'Real_Nick' }), admin, { username: 'Hacker_Nick' });
  assert.equal(r.status, 200);
  assert.equal(rows[0].telegram_username, 'Real_Nick');
  assert.deepEqual(admin.calls.map(c => [c.col, c.val]), [['telegram_id', 42]]);
});
test('неверная или просроченная подпись и пустой initData: запись не выполняется', async () => {
  for (const initData of [(await signed({ id: 42, username: 'Mama_One' })).replace('hash=', 'hash=0'), await signed({ id: 42, username: 'Mama_One' }, { auth_date: String(NOW - 7200) }), '']) {
    const admin = fakeAdmin(users());
    const r = await run(initData, admin);
    assert.equal(r.status, 401, initData.slice(0, 20));
    assert.equal(admin.calls.length, 0);
  }
});
test('превышен лимит частоты: 429 и запись не выполняется', async () => {
  const admin = fakeAdmin(users());
  const r = await run(await signed({ id: 42, username: 'Mama_One' }), admin, { hit: async () => false });
  assert.equal(r.status, 429);
  assert.equal(admin.calls.length, 0);
});
test('у аккаунта нет ника в Telegram: прежний ник очищается; сбой базы не даёт исключения', async () => {
  const rows = users(); rows[0].telegram_username = 'Old_Nick';
  assert.equal((await run(await signed({ id: 42, first_name: 'Ivan' }), fakeAdmin(rows))).status, 200);
  assert.equal(rows[0].telegram_username, null);
  const broken = { from: () => ({ update: () => ({ eq: () => ({ select: async () => { throw new Error('db down'); } }) }) }) };
  assert.deepEqual(await run(await signed({ id: 42, username: 'Mama_One' }), broken), { status: 200, body: { ok: false } });
});
