import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { safeFetch } from './safeFetch';
import { ERR_NETWORK, fallbackError } from './userError';
import { coachError, errMsg } from './coach';

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

  // Ревью #759: интеграция с настоящим supabase-js, а не только с fetch-обёрткой
  it('настоящий клиент supabase-js: сбой сети — ответ { error } с понятным текстом, а не отклонённый Promise', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = createClient('http://fake.supabase', 'key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch(async () => { throw new TypeError('Failed to fetch'); }) } });
    const rpc = await client.rpc('any_function', { a: 1 });
    expect(rpc.error?.message).toBe(ERR_NETWORK);
    const sel = await client.from('players').select('id').retry(false); // без повторов postgrest-js (GET по умолчанию повторяется с паузами)
    expect(sel.error?.message).toBe(ERR_NETWORK);
    expect(sel.data).toBeNull();
    spy.mockRestore();
  });
  // Ревью #759 (повторное): русский ERR_NETWORK из safeFetch не должен превращаться в общий текст
  it('полный путь: сбой сети → safeFetch → supabase error → errMsg/coachError/fallbackError даёт ERR_NETWORK', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = createClient('http://fake.supabase', 'key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch(async () => { throw new TypeError('Failed to fetch'); }) } });
    const rpc = await client.rpc('any_function', { a: 1 });
    expect(errMsg(rpc.error)).toBe(ERR_NETWORK);
    expect(coachError(rpc.error!.message)).toBe(ERR_NETWORK);
    expect(fallbackError(ERR_NETWORK)).toBe(ERR_NETWORK);
    spy.mockRestore();
  });
  it('настоящий клиент: ответ сервера с ошибкой базы проходит без изменений', async () => {
    const client = createClient('http://fake.supabase', 'key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch(async () => new Response(JSON.stringify({ message: 'permission denied', code: '42501' }), { status: 403, headers: { 'Content-Type': 'application/json' } })) } });
    const r = await client.rpc('any_function');
    expect(r.error?.code).toBe('42501');
  });
});
