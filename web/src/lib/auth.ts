import { SUPABASE_URL, supabase } from './supabase';

export class AuthError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

/** Вход через Telegram: initData → Edge Function tg-auth → token_hash → сессия Supabase. */
export async function signInWithTelegram(initData: string): Promise<void> {
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/tg-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({ initData }),
  });
  const body = (await res.json().catch(() => ({}))) as { token_hash?: string; error?: string; reason?: string };
  if (res.status === 429) throw new AuthError('Слишком много попыток входа. Подождите несколько минут и откройте приложение снова.', 'rate_limited');
  if (!res.ok || !body.token_hash) {
    throw new AuthError(`Не удалось войти (${body.error ?? res.status}${body.reason ? ': ' + body.reason : ''})`, body.error ?? 'http');
  }
  const { error } = await supabase.auth.verifyOtp({ token_hash: body.token_hash, type: 'email' });
  if (error) throw new AuthError(`Не удалось открыть сессию: ${error.message}`, 'verify');
}

/** Есть ли уже сессия (повторное открытие приложения в пределах срока жизни). */
export async function hasSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}
