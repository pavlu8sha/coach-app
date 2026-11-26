import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeFetch } from './safeFetch';
import { ERR_NETWORK } from './userError';

// Ревью #759: сетевой ответ safeFetch (503 + ERR_NETWORK) должен давать ROLE_ERR_NETWORK, а не общий текст
const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('./supabase', () => ({ get supabase() { return h.client; } }));

import { ROLE_ERR_GENERIC, ROLE_ERR_NETWORK, ROLE_ERR_PROFILE, ROLE_ERR_SESSION, roleErrorMessage, saveMyRole } from './role';

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
  it('42501 без признака сессии — общая ошибка, а не «профиль»', () => {
    expect(roleErrorMessage({ code: '42501', message: 'permission denied for function set_my_role' })).toBe(ROLE_ERR_GENERIC);
  });
  it('истёкшая сессия отличается от пропавшего профиля', () => {
    expect(roleErrorMessage({ code: '42501', message: 'forbidden' })).toBe(ROLE_ERR_SESSION);
    expect(roleErrorMessage({ message: 'JWT expired' })).toBe(ROLE_ERR_SESSION);
  });
});

describe('saveMyRole при сетевом сбое', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  it('сбой fetch на RPC → ROLE_ERR_NETWORK', async () => {
    h.client = mk(async () => { throw new TypeError('Failed to fetch'); });
    expect(await saveMyRole('parent')).toEqual({ ok: false, text: ROLE_ERR_NETWORK, kind: 'network' });
  });
  it('ответ 503 с ERR_NETWORK на RPC → ROLE_ERR_NETWORK', async () => {
    h.client = mk(async () => new Response(JSON.stringify({ message: ERR_NETWORK }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    expect(await saveMyRole('parent')).toEqual({ ok: false, text: ROLE_ERR_NETWORK, kind: 'network' });
  });
  it('RPC прошёл, а проверка пользователя вернула сетевую ошибку → ROLE_ERR_NETWORK, не «профиль»', async () => {
    h.client = {
      rpc: async () => ({ error: null }),
      auth: { getUser: async () => ({ data: { user: null }, error: { message: ERR_NETWORK } }) },
    };
    expect(await saveMyRole('parent')).toEqual({ ok: false, text: ROLE_ERR_NETWORK, kind: 'network' });
  });
  it('нет сессии после RPC → сообщение о сессии, не о профиле', async () => {
    h.client = {
      rpc: async () => ({ error: null }),
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    };
    expect(await saveMyRole('parent')).toEqual({ ok: false, text: ROLE_ERR_SESSION, kind: 'session' });
  });
  it('RPC прошёл, но строки профиля нет → ROLE_ERR_PROFILE', async () => {
    h.client = {
      rpc: async () => ({ error: null }),
      auth: { getUser: async () => ({ data: { user: { id: 'u' } }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    };
    expect(await saveMyRole('parent')).toEqual({ ok: false, text: ROLE_ERR_PROFILE, kind: 'profile' });
  });
});
