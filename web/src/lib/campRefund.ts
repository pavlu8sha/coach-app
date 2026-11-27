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

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;
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
  const res = await supabase.rpc('camp_refund', { pid: r.pid, amt: r.amt, d: r.d, cmt: r.cmt, req: refundKey(r) });
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
