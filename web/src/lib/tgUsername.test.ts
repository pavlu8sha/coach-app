import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { resetTgUsernameSync, syncTelegramUsername } from './tgUsername';

// A1 (docs/acceptance/parent-tg-username-2026-11-21.md): ник из Telegram уходит в базу один раз за открытие; сбой не ломает вход.
const setTg = (user: { username?: string } | null, initData = 'query_id=1&hash=x') => {
  (window as any).Telegram = user === undefined ? undefined : { WebApp: { initData, initDataUnsafe: { user } } };
};
beforeEach(() => resetTgUsernameSync());
afterEach(() => { delete (window as any).Telegram; });

describe('ник из Telegram', () => {
  it('внутри Telegram с ником: set_my_tg_username с ником', async () => {
    setTg({ username: 'Mama_One' });
    await syncTelegramUsername();
    expect(fake.rpcCalls('set_my_tg_username')).toEqual([{ p: 'Mama_One' }]);
  });
  it('внутри Telegram без ника: уходит null (очистить прежний)', async () => {
    setTg({});
    await syncTelegramUsername();
    expect(fake.rpcCalls('set_my_tg_username')).toEqual([{ p: null }]);
  });
  it('вне Telegram: не вызывается', async () => {
    await syncTelegramUsername();
    expect(fake.rpcCalls('set_my_tg_username')).toHaveLength(0);
  });
  it('один раз за открытие', async () => {
    setTg({ username: 'Mama_One' });
    await syncTelegramUsername();
    await syncTelegramUsername();
    expect(fake.rpcCalls('set_my_tg_username')).toHaveLength(1);
  });
  it('ошибка базы (функции ещё нет) или сбой связи: тихо, без исключения', async () => {
    setTg({ username: 'Mama_One' });
    fake.rpc.set_my_tg_username = () => ({ error: { message: 'Could not find the function public.set_my_tg_username', code: 'PGRST202' } });
    await expect(syncTelegramUsername()).resolves.toBeUndefined();
    resetTgUsernameSync();
    fake.rpc.set_my_tg_username = () => Promise.reject(new Error('network'));
    await expect(syncTelegramUsername()).resolves.toBeUndefined();
  });
});
