import { supabase } from './supabase';
import { userError, genericKnown } from './userError';

// Идемпотентная запись платежа абонемента (#724, миграция 0214): одно действие = один ключ.
// Ключ хранится, пока нет успешного ответа: повтор с теми же данными после ошибки или потери связи уходит с тем же ключом,
// и база возвращает уже записанный платёж вместо второго. Другие данные получают новый ключ. После успеха ключ сбрасывается.
// Ключ хранится только в памяти (до 30 минут): браузерное хранилище разрешено лишь в местах из src/nav/guard.test.ts. После перезагрузки страницы ключ теряется.
const TTL_MS = 30 * 60 * 1000;

export interface PaymentInput { player_id: string; amount: number; paid_on: string; method: string; for_month?: string | null }
export interface PaymentResult { error: { message: string } | null; duplicate: boolean }

interface Saved { sig: string; key: string; at: number }
const memory = new Map<string, Saved>();

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;
const sigOf = (p: PaymentInput) => JSON.stringify([p.player_id, p.amount, p.paid_on, p.method, p.for_month ?? null]);

const load = (scope: string): Saved | null => memory.get(scope) ?? null;
const store = (scope: string, s: Saved | null) => { if (s) memory.set(scope, s); else memory.delete(scope); };

/** Ключ для этих данных: прежний, если данные те же и он не просрочен; иначе новый. */
export function paymentKey(p: PaymentInput): string {
  const scope = p.player_id, sig = sigOf(p);
  const s = load(scope);
  if (s && s.sig === sig && Date.now() - s.at < TTL_MS) return s.key;
  const fresh = { sig, key: newKey(), at: Date.now() };
  store(scope, fresh);
  return fresh.key;
}

export async function addPayment(p: PaymentInput): Promise<PaymentResult> {
  const amount = Math.round(p.amount * 100) / 100;
  const input = { ...p, amount };
  const r = await supabase.rpc('payment_add', { req: paymentKey(input), pid: p.player_id, amt: amount, d: p.paid_on, mth: p.method, fm: p.for_month ?? null });
  if (r.error) return { error: r.error, duplicate: false };
  store(p.player_id, null);
  return { error: null, duplicate: Boolean((r.data as { duplicate?: boolean } | null)?.duplicate) };
}

export const DUPLICATE_PAYMENT_NOTE = 'Этот платёж уже был записан ранее, второй не создан.';

/** Текст ошибки записи платежа: общие случаи и ключ, использованный с другими данными. */
export const paymentError = (e: unknown): string =>
  userError(e, m => /request id reused/.test(m) ? 'Платёж с такими данными уже записан с другими параметрами. Проверьте список платежей игрока.' : genericKnown(m));

/** Только для тестов: забыть сохранённые ключи. */
export function resetPaymentKeys(): void {
  memory.clear();
}
