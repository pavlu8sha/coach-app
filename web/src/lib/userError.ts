export const ERR_NETWORK = 'Нет связи. Проверьте интернет и попробуйте ещё раз.';
export const ERR_GENERIC = 'Не удалось выполнить действие. Попробуйте ещё раз.';

const NETWORK = /fetch|network|failed to load|timeout|load failed/i;

/**
 * Понятный текст для пользователя вместо сообщения Supabase/сети (продолжение #705).
 * `known` переводит ожидаемые ошибки базы (лимиты, согласие и т. п.) и возвращает null для неизвестных.
 * Сырое сообщение пользователю не показывается никогда; подробности только в журнал.
 */
export function userError(err: unknown, known: (m: string) => string | null): string {
  const m = String((err as { message?: unknown } | null)?.message ?? err ?? '');
  console.error('ошибка действия', err);
  const k = m ? known(m) : null;
  if (k) return k;
  return err instanceof TypeError || NETWORK.test(m) ? ERR_NETWORK : ERR_GENERIC;
}
