import { createClient } from '@supabase/supabase-js';
import { safeFetch } from './safeFetch';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configured = Boolean(SUPABASE_URL && KEY);

// Ключ публичный (publishable): доступ ограничивают политики RLS в базе
export const supabase = createClient(SUPABASE_URL ?? 'http://localhost', KEY ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: safeFetch((input, init) => fetch(input, init)) }, // сетевой отказ — ответ с ошибкой, а не отклонённый Promise
});
