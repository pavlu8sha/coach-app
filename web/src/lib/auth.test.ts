import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { AuthError, hasSession, signInWithTelegram, signInWithWidget } from './auth';

const reply = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 300, status, json: async () => body }) as Response);

describe('вход через Edge Functions', () => {
  it('Mini App: initData уходит в tg-auth, токен обменивается на сессию', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    const f = reply(200, { token_hash: 'th' });
    vi.stubGlobal('fetch', f);
    await signInWithTelegram('query_id=1&hash=x');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://fake.supabase/functions/v1/tg-auth');
    expect(JSON.parse(String(init.body))).toEqual({ initData: 'query_id=1&hash=x' });
    expect((init.headers as Record<string, string>).apikey).toBe('sb_publishable_test');
    expect(fake.calls.find(c => c.name === 'auth.verifyOtp')?.args).toEqual({ token_hash: 'th', type: 'email' });
  });

  it('браузер: данные виджета уходят в tg-login', async () => {
    const f = reply(200, { token_hash: 'th2' });
    vi.stubGlobal('fetch', f);
    await signInWithWidget({ id: 7, first_name: 'Анна', auth_date: 1, hash: 'h' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://fake.supabase/functions/v1/tg-login');
    expect(JSON.parse(String(init.body))).toEqual({ auth: { id: 7, first_name: 'Анна', auth_date: 1, hash: 'h' } });
  });

  it('лимит входов: понятная ошибка с кодом rate_limited', async () => {
    vi.stubGlobal('fetch', reply(429, { error: 'rate_limited' }));
    await expect(signInWithTelegram('x')).rejects.toMatchObject({ code: 'rate_limited', message: expect.stringContaining('Слишком много попыток') });
  });

  it('отказ сервера: ошибка с причиной, сессия не открывается', async () => {
    vi.stubGlobal('fetch', reply(401, { error: 'unauthorized', reason: 'bad_hash' }));
    const err = await signInWithWidget({ id: 1 }).catch(e => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.message).toContain('unauthorized: bad_hash');
    expect(fake.calls.some(c => c.name === 'auth.verifyOtp')).toBe(false);
  });

  it('сессия есть или нет', async () => {
    expect(await hasSession()).toBe(true);
    fake.user = null;
    expect(await hasSession()).toBe(false);
  });
});
