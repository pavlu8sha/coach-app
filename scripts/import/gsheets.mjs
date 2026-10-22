// Чтение листа Google Sheets сервисным аккаунтом (только чтение). Без зависимостей.
// Переменные: GOOGLE_SA_JSON (ключ сервисного аккаунта, только из окружения, не в репозиторий).
import crypto from 'node:crypto';

const b64u = b => Buffer.from(b).toString('base64url');

// JWT для обмена на токен доступа (scope — только чтение таблиц)
export function buildJwt(sa, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key).toString('base64url');
  return `${header}.${claim}.${sig}`;
}

export async function accessToken(sa) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: buildJwt(sa) }),
  });
  if (!res.ok) throw new Error('Токен Google: ' + res.status + ' ' + (await res.text()));
  return (await res.json()).access_token;
}

// Значения диапазона, например 'РЕЕСТР ИГРОКОВ'!A1:H400. Возвращает массив строк (строки — массивы текста).
export async function readRange(spreadsheetId, range, token) {
  const url = `https://sheets.googleapis.com/v1/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Чтение ${range}: ${res.status} ${await res.text()}`);
  return (await res.json()).values || [];
}
