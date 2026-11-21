// Ник Telegram для кнопки «Написать в Telegram» у тренера (миграция 0218). Берётся только из initData с проверенной подписью.
// Формат Telegram: 5-32 знака, латиница, цифры, «_», начинается с буквы; в базе допускается 4-32 (ограничение users_telegram_username_check).
export function normalizeTgUsername(u) {
  const v = String(u ?? '').trim().replace(/^@+/, '');
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(v) ? v : null;
}
