// Логика функции camp-docs без обращений к сети: проверка файла и разбор запроса. Тесты: tests/edge/camp-docs-logic.test.mjs.
export const MAX_BYTES = 10 * 1024 * 1024;
export const BUCKET = 'camp-docs';
export const LINK_SECONDS = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => typeof s === 'string' && UUID.test(s);

// Файл принимается, только если это PDF по содержимому (подпись %PDF- в начале и метка %%EOF в конце), а не по имени или заголовку.
export function checkPdf(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { ok: false, reason: 'empty' };
  if (bytes.length > MAX_BYTES) return { ok: false, reason: 'too_large' };
  const head = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  for (let i = 0; i < head.length; i++) if (bytes[i] !== head[i]) return { ok: false, reason: 'not_pdf' };
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
  if (!tail.includes('%%EOF')) return { ok: false, reason: 'not_pdf' };
  return { ok: true, reason: null };
}

// Параметры загрузки из адреса: camp, title, replaces (необязательно)
export function parseUpload(params) {
  const camp = params.get('camp') ?? '';
  const title = (params.get('title') ?? '').trim();
  const replaces = params.get('replaces') || null;
  if (!isUuid(camp) || (replaces !== null && !isUuid(replaces))) return { ok: false, reason: 'bad_request' };
  if (!title || [...title].length > 120) return { ok: false, reason: 'bad_title' };
  return { ok: true, camp, title, replaces };
}

// Путь из базы обязан иметь вид <uuid сбора>/<uuid документа>.pdf: другое в хранилище не пишем и не подписываем
export function safePath(path) {
  if (typeof path !== 'string') return false;
  const m = path.match(/^([^/]+)\/([^/]+)\.pdf$/);
  return !!m && isUuid(m[1]) && isUuid(m[2]);
}

// Ошибка функции базы -> ответ. Тексты базы наружу отдаются только из известного списка.
const KNOWN = new Set(['bad document', 'too many documents', 'camp not found', 'document not found', 'not pending']);
export function rpcFailure(error) {
  const code = error?.code ?? '';
  const message = String(error?.message ?? '');
  if (code === '42501' || /forbidden|permission denied/i.test(message)) return { status: 403, error: 'forbidden' };
  if (code === 'P0002') return { status: 404, error: KNOWN.has(message) ? message : 'not_found' };
  if (code === '22023') return { status: 400, error: KNOWN.has(message) ? message : 'bad_request' };
  if (code === 'PGRST301' || /jwt/i.test(message)) return { status: 401, error: 'unauthorized' };
  return { status: 500, error: 'internal' };
}
