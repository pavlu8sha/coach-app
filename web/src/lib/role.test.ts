import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeFetch } from './safeFetch';
import { ERR_NETWORK } from './userError';

// Ревью #759: сетевой ответ safeFetch (503 + ERR_NETWORK) должен давать ROLE_ERR_NETWORK, а не общий текст
const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('./supabase', () => ({ get supabase() { return h.client; } }));

import { ROLE_ERR_GENERIC, ROLE_ERR_NETWORK, ROLE_ERR_PROFILE, roleErrorMessage, saveMyRole } from './role';

const mk = (inner: typeof fetch) => createClient('http://fake.supabase', 'key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch(inner) } });

describe('roleErrorMessage', () => {
  it('ERR_NETWORK из safeFetch → сетевой текст', () => {
    expect(roleErrorMessage({ message: ERR_NETWORK })).toBe(ROLE_ERR_NETWORK);
    expect(roleErrorMessage(new TypeError('Failed to fetch'))).toBe(ROLE_ERR_NETWORK);
  });
  it('профиль и неизвестное сохраняют свои тексты', () => {
    expect(roleErrorMessage({ code: 'P0002', message: 'profile_missing' })).toBe(ROLE_ERR_PROFILE);
    expect(roleErrorMessage({ message: 'что-то странное' })).toBe(ROLE_ERR_GENERIC);
  });
});

describe('saveMyRole при сетевом сбое', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  it('сбой fetch на RPC → ROLE_ERR_NETWORK', async () => {
    h.client = mk(async () => { throw new TypeError('Failed to fetch'); });
    expect(await saveMyRole('parent')).toEqual({ ok: false, text: ROLE_ERR_NETWORK });
  });
  it('ответ 503 с ERR_NETWORK на RPC → ROLE_ERR_NETWORK', async () => {
    h.client = mk(async () => new Response(JSON.stringify({ message: ERR_NETWORK }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    expect(await saveMyRole('parent')).toEqual({ ok: false, text: ROLE_ERR_NETWORK });
  });
  it('RPC прошёл, а проверка пользователя вернула сетевую ошибку → ROLE_ERR_NETWORK, не «профиль»', async () => {
    h.client = {
      rpc: async () => ({ error: null }),
      auth: { getUser: async () => ({ data: { user: null }, error: { message: ERR_NETWORK } }) },
    };
    expect(await saveMyRole('parent')).toEqual({ ok: false, text: ROLE_ERR_NETWORK });
  });
});
