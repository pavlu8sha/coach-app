// Проверка подписи виджета входа Telegram (Telegram Login Widget) для входа из обычного браузера.
// Отличается от initData Mini App: секрет = SHA-256 от токена бота (а не HMAC «WebAppData»), поля приходят как объект.
// Без зависимостей, Web Crypto: работает и в Deno (Edge Function), и в Node (тесты).
// Источник: https://core.telegram.org/widgets/login#checking-authorization
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function hmacHex(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

// Сравнение за постоянное время (строки hex одинаковой длины)
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const dataCheckString = fields => Object.entries(fields).filter(([k]) => k !== 'hash').map(([k, v]) => `${k}=${v}`).sort().join('\n');

/**
 * @param {Record<string, unknown>} auth  объект из виджета: id, first_name, last_name?, username?, photo_url?, auth_date, hash
 * @param {string} botToken  токен бота (только в секретах функции)
 * @param {{maxAgeSec?: number, now?: number}} [opts]  срок жизни подписи (по умолчанию 1 час) и «сейчас» для тестов
 * @returns {Promise<{ok: true, user: {id: number, first_name?: string, last_name?: string, username?: string}, authDate: number} | {ok: false, reason: string}>}
 */
export async function validateLoginWidget(auth, botToken, { maxAgeSec = 3600, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!auth || typeof auth !== 'object' || Array.isArray(auth) || !botToken) return { ok: false, reason: 'empty' };
  const hash = typeof auth.hash === 'string' ? auth.hash.toLowerCase() : '';
  if (!hash) return { ok: false, reason: 'no_hash' };
  // подписываются все присланные поля, кроме hash; значения — строки, как их отдал Telegram
  const fields = {};
  for (const [k, v] of Object.entries(auth)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') return { ok: false, reason: 'bad_field' };
    fields[k] = String(v);
  }
  const secret = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(botToken)));
  const calc = await hmacHex(secret, dataCheckString(fields));
  if (!safeEqual(calc, hash)) return { ok: false, reason: 'bad_hash' };
  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'no_auth_date' };
  if (now - authDate > maxAgeSec) return { ok: false, reason: 'expired' };
  if (authDate - now > 300) return { ok: false, reason: 'from_future' };
  const id = Number(fields.id);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: 'no_user' };
  const user = { id };
  for (const k of ['first_name', 'last_name', 'username']) if (fields[k]) user[k] = fields[k];
  return { ok: true, user, authDate };
}

/** Для тестов: добавляет правильную подпись к полям виджета. */
export async function signLoginWidget(fields, botToken) {
  const str = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]));
  const secret = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(botToken)));
  return { ...fields, hash: await hmacHex(secret, dataCheckString(str)) };
}
