import { supabase } from './supabase';

// Идемпотентный возврат за сбор (#721, миграция 0231): одно подтверждённое действие = один ключ.
// Ключ хранится, пока нет успешного ответа: повтор тех же данных после ошибки или потери связи уходит с тем же ключом,
// и база возвращает уже записанный возврат вместо второго. Другие данные получают новый ключ. После успеха ключ сбрасывается.
// Ключ хранится только в памяти (до 30 минут): браузерное хранилище разрешено лишь в местах из src/nav/guard.test.ts.
const TTL_MS = 30 * 60 * 1000;

export interface RefundInput { pid: string; amt: number; d: string | null; cmt: string | null }
export interface RefundResult { error: { message: string } | null; duplicate: boolean }

interface Saved { sig: string; key: string; at: number }
const memory = new Map<string, Saved>();

// Ключ только из криптографического генератора: без него операция не выполняется (ключ из времени мог бы совпасть у двух самостоятельных возвратов).
const newKey = (): string => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  throw new Error('crypto unavailable');
};
const sigOf = (r: RefundInput) => JSON.stringify([r.pid, r.amt, r.d, r.cmt]);

/** Ключ для этих данных: прежний, если данные те же и он не просрочен; иначе новый. */
export function refundKey(r: RefundInput): string {
  const sig = sigOf(r), s = memory.get(r.pid);
  if (s && s.sig === sig && Date.now() - s.at < TTL_MS) return s.key;
  const fresh = { sig, key: newKey(), at: Date.now() };
  memory.set(r.pid, fresh);
  return fresh.key;
}

export async function refundCamp(r: RefundInput): Promise<RefundResult> {
  let req: string;
  try { req = refundKey(r); } catch { return { error: { message: 'Не удалось создать ключ операции: возврат не выполнен, чтобы не записать его дважды. Обновите браузер.' }, duplicate: false }; }
  const res = await supabase.rpc('camp_refund', { pid: r.pid, amt: r.amt, d: r.d, cmt: r.cmt, req });
  if (res.error) return { error: res.error, duplicate: false };
  memory.delete(r.pid);
  return { error: null, duplicate: Boolean((res.data as { duplicate?: boolean } | null)?.duplicate) };
}

export const DUPLICATE_REFUND_NOTE = 'Этот возврат уже был записан ранее, второй не создан.';
export const REUSED_REFUND_NOTE = 'Возврат с такими данными уже записан с другими параметрами. Проверьте список платежей участника.';

/** Только для тестов: забыть сохранённые ключи. */
export function resetRefundKeys(): void {
  memory.clear();
}
