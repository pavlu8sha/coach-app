import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTgUsernameSync, syncTelegramUsername } from './tgUsername';

// A1 (docs/acceptance/parent-tg-username-2026-11-21.md): ник клиент не пишет; подписанные initData уходят в tg-auth один раз за открытие; сбой не ломает вход.
const setTg = (initData: string, username?: string) => { (window as any).Telegram = { WebApp: { initData, initDataUnsafe: { user: { username } } } }; };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { resetTgUsernameSync(); fetchMock = vi.fn(async () => new Response('{"ok":true}')); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { delete (window as any).Telegram; vi.unstubAllGlobals(); });

describe('ник из Telegram', () => {
  it('внутри Telegram: в tg-auth уходят подписанные initData, а не ник из initDataUnsafe', async () => {
    setTg('query_id=1&hash=abc', 'Fake_Nick');
    await syncTelegramUsername();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/functions\/v1\/tg-auth$/);
    expect(JSON.parse(init.body)).toEqual({ initData: 'query_id=1&hash=abc', username_only: true });
    expect(init.body).not.toContain('Fake_Nick');
  });
  it('вне Telegram или без initData: не вызывается', async () => {
    await syncTelegramUsername();
    setTg('', 'x_nick');
    await syncTelegramUsername();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('один раз за открытие', async () => {
    setTg('query_id=1&hash=abc');
    await syncTelegramUsername();
    await syncTelegramUsername();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('сбой связи или ответ сервера с ошибкой: тихо, без исключения', async () => {
    setTg('query_id=1&hash=abc');
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(syncTelegramUsername()).resolves.toBeUndefined();
    resetTgUsernameSync();
    fetchMock.mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401 }));
    await expect(syncTelegramUsername()).resolves.toBeUndefined();
  });
});
