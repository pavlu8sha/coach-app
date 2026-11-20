import { ERR_NETWORK } from './userError';

/**
 * Обёртка над fetch для клиента Supabase: сетевой отказ (нет связи, обрыв в webview) становится ответом 503 с понятным
 * сообщением, а не отклонённым Promise. Тогда supabase-js (в том числе вход, хранилище, функции) возвращает { error },
 * и экраны не зависают в состоянии «busy». Отмена запроса (AbortError) остаётся отменой.
 */
export const safeFetch = (inner: typeof fetch) => async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  try {
    return await inner(input, init);
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'AbortError') throw e;
    console.error('сетевой сбой', e);
    return new Response(JSON.stringify({ message: ERR_NETWORK }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
};
