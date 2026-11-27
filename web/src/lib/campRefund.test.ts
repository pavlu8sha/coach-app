import { afterEach, describe, expect, it, vi } from 'vitest';
import { refundKey, refundCamp, resetRefundKeys } from './campRefund';
import { fake } from '../test/fakeSupabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const r = { pid: 'p1', amt: 100, d: '2026-11-27', cmt: null };

afterEach(() => { vi.unstubAllGlobals(); resetRefundKeys(); });

describe('ключ возврата (#721)', () => {
  it('тот же ключ для тех же данных, новый для других', () => {
    const a = refundKey(r);
    expect(refundKey(r)).toBe(a);
    expect(refundKey({ ...r, amt: 101 })).not.toBe(a);
  });
  it('без randomUUID ключ строится из getRandomValues и является корректным v4 UUID, разные у разных операций', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } });
    const a = refundKey(r), b = refundKey({ ...r, pid: 'p2' });
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
  });
  it('без криптографического генератора возврат не отправляется, а не уходит с ключом из времени', async () => {
    vi.stubGlobal('crypto', undefined);
    
    fake.rpc.camp_refund = () => ({ id: 'r1', duplicate: false });
    const res = await refundCamp(r);
    expect(res.error).not.toBeNull();
    expect(fake.rpcCalls('camp_refund')).toHaveLength(0);
  });
});
