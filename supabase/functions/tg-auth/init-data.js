// Проверка подписи initData Telegram Mini App (метод с токеном бота).
// Без зависимостей, Web Crypto: работает и в Deno (Edge Function), и в Node (тесты).
// Источник: https://docs.telegram-mini-apps.com/platform/init-data
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(message));
}

// Сравнение за постоянное время (строки hex одинаковой длины)
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * @param {string} initData  сырая строка initData из Telegram.WebApp.initData
 * @param {string} botToken  токен бота (хранится только в секретах функции)
 * @param {{maxAgeSec?: number, now?: number}} [opts]  срок жизни подписи (по умолчанию 1 час) и «сейчас» для тестов
 * @returns {Promise<{ok: true, user: {id: number, first_name?: string, last_name?: string, username?: string}, authDate: number} | {ok: false, reason: string}>}
 */
export async function validateInitData(initData, botToken, { maxAgeSec = 3600, now = Math.floor(Date.now() / 1000) } = {}) {
  if (typeof initData !== 'string' || !initData || !botToken) return { ok: false, reason: 'empty' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no_hash' };
  const dataCheckString = [...params.entries()].filter(([k]) => k !== 'hash').map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken); // сырые байты, не hex
  const calc = hex(await hmac(secret, dataCheckString));
  if (!safeEqual(calc, hash.toLowerCase())) return { ok: false, reason: 'bad_hash' };
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'no_auth_date' };
  if (now - authDate > maxAgeSec) return { ok: false, reason: 'expired' };
  if (authDate - now > 300) return { ok: false, reason: 'from_future' };
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { /* ниже отказ */ }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return { ok: false, reason: 'no_user' };
  return { ok: true, user, authDate };
}

/** Для тестов: собирает правильно подписанную строку initData. */
export async function signInitData(fields, botToken) {
  const dcs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  return new URLSearchParams({ ...fields, hash: hex(await hmac(secret, dcs)) }).toString();
}
