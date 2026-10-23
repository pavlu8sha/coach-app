import { SUPABASE_URL, supabase } from './supabase';

export class AuthError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

/** Обмен подписанных данных Telegram на сессию Supabase через Edge Function: токен одноразовый, сессию выдаёт сам Supabase. */
async function signInVia(fn: 'tg-auth' | 'tg-login', body: object): Promise<void> {
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as { token_hash?: string; error?: string; reason?: string };
  if (res.status === 429) throw new AuthError('Слишком много попыток входа. Подождите несколько минут и откройте приложение снова.', 'rate_limited');
  if (!res.ok || !out.token_hash) {
    throw new AuthError(`Не удалось войти (${out.error ?? res.status}${out.reason ? ': ' + out.reason : ''})`, out.error ?? 'http');
  }
  const { error } = await supabase.auth.verifyOtp({ token_hash: out.token_hash, type: 'email' });
  if (error) throw new AuthError(`Не удалось открыть сессию: ${error.message}`, 'verify');
}

/** Вход через Telegram Mini App: initData → Edge Function tg-auth → token_hash → сессия Supabase. */
export const signInWithTelegram = (initData: string): Promise<void> => signInVia('tg-auth', { initData });

/** Вход из обычного браузера: данные виджета Telegram Login → Edge Function tg-login (тот же пользователь, что в Mini App). */
export const signInWithWidget = (auth: Record<string, unknown>): Promise<void> => signInVia('tg-login', { auth });

/** Есть ли уже сессия (повторное открытие приложения в пределах срока жизни). */
export async function hasSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}
