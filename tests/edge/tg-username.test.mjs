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
