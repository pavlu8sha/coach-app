export const ERR_NETWORK = 'Нет связи. Проверьте интернет и попробуйте ещё раз.';
export const ERR_GENERIC = 'Не удалось выполнить действие. Попробуйте ещё раз.';

const NETWORK = /fetch|network|failed to load|timeout|load failed/i;

/**
 * Запасной текст для неизвестной ошибки: сеть → «Нет связи», остальное → общий. Сообщение на русском
 * (написанное для пользователя в базе или экране) проходит как есть, остальное только в журнал.
 */
export function fallbackError(raw: string): string {
  if (/[А-Яа-яЁё]/.test(raw)) return raw;
  console.error('ошибка действия', raw);
  return NETWORK.test(raw) ? ERR_NETWORK : ERR_GENERIC;
}

/** Общие ошибки, одинаковые для любого экрана (права, сессия, функция не установлена); доменные тексты задают мапперы экранов. */
export const genericKnown = (m: string): string | null =>
  /forbidden|42501|permission denied/i.test(m) ? 'Нет прав на это действие.'
  : /not authenticated|jwt/i.test(m) ? 'Сессия закончилась. Закройте приложение и откройте снова.'
  : /Could not find the function|schema cache/.test(m) ? 'Эта функция ещё не установлена в базе. Сообщите администратору.'
  : null;

/**
 * Понятный текст для пользователя вместо сообщения Supabase/сети (продолжение #705).
 * `known` переводит ожидаемые ошибки базы (лимиты, согласие и т. п.) и возвращает null для неизвестных.
 * Сырое сообщение пользователю не показывается никогда; подробности только в журнал.
 */
export function userError(err: unknown, known: (m: string) => string | null): string {
  const m = String((err as { message?: unknown } | null)?.message ?? err ?? '');
  const k = m ? known(m) : null;
  if (k) return k;
  if (err instanceof TypeError) {
    console.error('ошибка действия', err);
    return ERR_NETWORK;
  }
  return fallbackError(m);
}
