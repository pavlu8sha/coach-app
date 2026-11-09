// Документы сбора (Issue #470, этап 5, миграция 0169). Хранилище camp-docs закрыто, политик чтения нет:
// файл можно получить только по ссылке на 60 секунд, которую выдаёт эта функция после проверки прав в базе.
//  POST ?action=upload&camp=<id>&title=<название>[&replaces=<id версии>], тело: PDF (до 10 МБ) -> { id }
//       Права (только администратор) проверяет camp_document_begin от имени пользователя. Файл проверяется по содержимому.
//  POST { action: 'link', id } -> { url, expires_in }
//       Права (подтверждённый участник сбора, администратор) проверяет camp_document_path от имени пользователя.
// Сервисный ключ используется только для записи в хранилище, подписи ссылки и camp_document_finish; решение о доступе
// сервисным ключом не принимается. Секретов, кроме выдаваемых платформой, нет. Деплой с проверкой JWT (по умолчанию).
// ВАЖНО: файл не проверялся на живом проекте: первая проверка на проде после применения 0169, по слову владельца.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { BUCKET, checkPdf, isUuid, LINK_SECONDS, MAX_BYTES, parseUpload, rpcFailure, safePath } from './docs-logic.js';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};
const json = (body: unknown, status = 200) =>
  status === 204
    ? new Response(null, { status, headers: cors })
    : new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json(null, 204);
  try {
    return await handle(req);
  } catch (e) {
    console.error('camp-docs', e instanceof Error ? e.message : String(e));
    return json({ error: 'internal' }, 500);
  }
});

// Тело читаем с ограничением: больше 10 МБ в память не берём, даже если заголовок длины занижен или отсутствует
async function readLimited(req: Request, max = MAX_BYTES): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+/i.test(auth)) return json({ error: 'unauthorized' }, 401);

  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  // Сервисный ключ вместо пользовательского не принимаем: права должен проверять пользовательский запрос
  if (!anon || !base || !service) { console.error('camp-docs: не заданы переменные Supabase'); return json({ error: 'config' }, 500); }
  if (auth.replace(/^Bearer\s+/i, '') === service) return json({ error: 'unauthorized' }, 401);
  const user = createClient(base, anon, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } });
  const admin = createClient(base, service, { auth: { persistSession: false } });

  const url = new URL(req.url);
  if (url.searchParams.get('action') === 'upload') {
    const p = parseUpload(url.searchParams);
    if (!p.ok) return json({ error: p.reason }, 400);
    if (Number(req.headers.get('content-length') ?? '0') > MAX_BYTES) return json({ error: 'too_large' }, 413);
    const bytes = await readLimited(req);
    if (bytes === null) return json({ error: 'too_large' }, 413);
    const chk = checkPdf(bytes);
    if (!chk.ok) return json({ error: chk.reason }, chk.reason === 'too_large' ? 413 : 400);

    const begun = await user.rpc('camp_document_begin', { cid: p.camp, title: p.title, size: bytes.length, replaces: p.replaces });
    if (begun.error) { const f = rpcFailure(begun.error); return json({ error: f.error }, f.status); }
    const id = String(begun.data?.id ?? ''), path = String(begun.data?.path ?? '');
    if (!isUuid(id) || !safePath(path)) return json({ error: 'internal' }, 500);

    const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
    if (up.error) {
      console.error('camp-docs upload', up.error.message);
      const fin = await admin.rpc('camp_document_finish', { did: id, ok: false });
      if (fin.error) console.error('camp-docs finish', fin.error.message);
      return json({ error: 'storage' }, 502);
    }
    const fin = await admin.rpc('camp_document_finish', { did: id, ok: true });
    if (fin.error) {
      // Ответ базы мог потеряться уже после публикации, поэтому сначала перечитываем статус версии.
      // Файл убираем, только если версия точно не опубликована; если статус узнать не удалось, файл не трогаем.
      console.error('camp-docs finish', fin.error.message);
      const st = await admin.from('camp_documents').select('status').eq('id', id).maybeSingle();
      if (st.error) { console.error('camp-docs status', st.error.message); return json({ error: 'unknown_state', id }, 502); }
      if (st.data?.status === 'ready') return json({ id });
      const rm = await admin.storage.from(BUCKET).remove([path]);
      if (rm.error) console.error('camp-docs remove', rm.error.message);
      return json({ error: 'not_published' }, 409);
    }
    return json({ id });
  }

  let body: { action?: unknown; id?: unknown } = {};
  const rawBody = await readLimited(req, 4096);
  if (rawBody === null) return json({ error: 'too_large' }, 413);
  try { body = JSON.parse(new TextDecoder().decode(rawBody)); } catch { return json({ error: 'bad_request' }, 400); }
  if (body?.action !== 'link' || !isUuid(body.id)) return json({ error: 'bad_request' }, 400);
  const got = await user.rpc('camp_document_path', { did: body.id });
  if (got.error) { const f = rpcFailure(got.error); return json({ error: f.error }, f.status); }
  if (!safePath(got.data)) return json({ error: 'forbidden' }, 403);
  const signed = await admin.storage.from(BUCKET).createSignedUrl(got.data as string, LINK_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    console.error('camp-docs sign', signed.error?.message);
    return json({ error: 'storage' }, 502);
  }
  return json({ url: signed.data.signedUrl, expires_in: LINK_SECONDS });
}
