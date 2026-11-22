// Ник Telegram для кнопки «Написать в Telegram» у тренера (миграция 0218). Берётся только из initData с проверенной подписью.
// Формат Telegram: 5-32 знака, латиница, цифры, «_», начинается с буквы; то же ограничение в базе (миграция 0218).
import { validateInitData } from './init-data.js';

export function normalizeTgUsername(u) {
  const v = String(u ?? '').trim().replace(/^@+/, '');
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v) ? v : null;
}

/** Записать ник в строку именно этого Telegram-аккаунта (id из проверенной подписи). true, если строка найдена и обновлена. */
export async function saveVerifiedUsername(admin, user) {
  const r = await admin.from('users').update({ telegram_username: normalizeTgUsername(user.username) }).eq('telegram_id', user.id).select('id');
  return !r.error && (r.data?.length ?? 0) > 0;
}

/**
 * Режим username_only: повторное открытие приложения с живой сессией. Вход не выдаётся.
 * Подпись initData проверяется, ник берётся только из проверенного user, строка выбирается по проверенному user.id.
 * Возвращает { status, body } для HTTP-ответа; при неверной подписи ничего не пишется.
 */
export async function handleUsernameOnly({ initData, botToken, admin, hit, now }) {
  const v = await validateInitData(initData, botToken, now === undefined ? {} : { now });
  if (!v.ok) return { status: 401, body: { error: 'unauthorized', reason: v.reason } };
  if (!(await hit(`tg:${v.user.id}`))) return { status: 429, body: { error: 'rate_limited' } };
  let saved = false;
  try { saved = await saveVerifiedUsername(admin, v.user); } catch { /* ник не критичен */ }
  return { status: 200, body: { ok: saved } };
}
