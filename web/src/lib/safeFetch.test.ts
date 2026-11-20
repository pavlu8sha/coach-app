import { describe, expect, it } from 'vitest';
import { safeFetch } from './safeFetch';
import { ERR_NETWORK } from './userError';

// Условия приёмки: docs/acceptance/user-errors-everywhere-2026-11-20.md №4
describe('safeFetch', () => {
  it('сетевой отказ превращается в ответ 503 с понятным сообщением, а не в отклонённый Promise', async () => {
    const res = await safeFetch(async () => { throw new TypeError('Failed to fetch'); })('http://x/rest/v1/rpc/f', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ message: ERR_NETWORK });
  });
  it('успешный ответ проходит без изменений', async () => {
    const ok = new Response('{"a":1}', { status: 200 });
    expect(await safeFetch(async () => ok)('http://x')).toBe(ok);
  });
  it('отмена запроса остаётся отменой', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(safeFetch(async () => { throw abort; })('http://x')).rejects.toBe(abort);
  });
});
