import { vi } from 'vitest';
import { supabase } from './fakeSupabase';

/** Отказ только n-го запроса к таблице (1 = первый): остальные идут как обычно. Нужен, когда одну таблицу читают несколько источников. */
export function failNth(table: string, n: number, message = 'boom') {
  const real = supabase.from;
  let count = 0;
  const spy = vi.spyOn(supabase, 'from').mockImplementation(((t: string) => {
    const q = real(t);
    if (t !== table || ++count !== n) return q;
    const proxy: any = new Proxy(q, {
      get(target, prop) {
        if (prop === 'then') return (res: any) => Promise.resolve({ data: null, error: { message } }).then(res);
        const v = target[prop];
        return typeof v === 'function' ? (...a: unknown[]) => { const r = v.apply(target, a); return r === target ? proxy : r; } : v;
      },
    });
    return proxy;
  }) as any);
  return { restore: () => spy.mockRestore() };
}
