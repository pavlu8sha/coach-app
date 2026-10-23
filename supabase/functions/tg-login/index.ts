// Вход через Telegram из обычного браузера (виджет Telegram Login). POST { auth } → { token_hash, email } для
// supabase.auth.verifyOtp({ token_hash, type: 'email' }). Тот же пользователь, что и в Mini App (tg<id>@telegram.invalid).
// Схема как у tg-auth: подпись проверяем сами (login-widget.js), пользователя заводим в Supabase Auth (админ-ключ),
// сессию клиент получает обычным способом от Supabase — свои JWT не подписываем.
// Секреты функции: TELEGRAM_BOT_TOKEN (тот же, что у tg-auth). Ограничение частоты — общие счётчики с tg-auth.
// ВАЖНО: файл не проверялся на живом проекте — первая проверка на staging (см. README.md).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { validateLoginWidget } from './login-widget.js';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};
// Ответ 204 не может иметь тела (иначе Response бросает ошибку и предзапрос браузера падает)
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  status === 204
    ? new Response(null, { status, headers: cors })
    : new Response(JSON.stringify(body), { status, headers: { ...cors, ...extra, 'Content-Type': 'application/json' } });

// Лимиты (счётчики в таблице rate_limits, функция rate_limit_hit — миграция 0016).
const PER_USER = { max: 10, seconds: 600 };   // входов с одного Telegram-аккаунта за 10 минут
const NEW_USERS = { max: 30, seconds: 3600 }; // новых аккаунтов во всём клубе за час

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json(null, 204);
  try {
    return await handle(req);
  } catch (e) {
    // любая ошибка — тоже с заголовками CORS, иначе браузер показывает только «Load failed»
    return json({ error: 'internal', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let auth: Record<string, unknown> | null = null;
  try {
    const body = await req.json();
    auth = body && typeof body.auth === 'object' ? (body.auth as Record<string, unknown>) : null;
  } catch { return json({ error: 'bad_request' }, 400); }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  const v = await validateLoginWidget(auth, botToken);
  if (!v.ok) return json({ error: 'unauthorized', reason: v.reason }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const email = `tg${v.user.id}@telegram.invalid`;
  const name = [v.user.first_name, v.user.last_name].filter(Boolean).join(' ') || v.user.username || null;

  // 0) ограничение частоты: без него один аккаунт может бесконечно создавать ссылки входа, а спам-аккаунты — заводить пользователей
  const hit = async (key: string, lim: { max: number; seconds: number }) => {
    const r = await admin.rpc('rate_limit_hit', { k: key, max_hits: lim.max, window_seconds: lim.seconds });
    if (r.error) throw new Error(`rate_limit: ${r.error.message}`); // при сбое лимитера не пускаем (закрыто по умолчанию)
    return r.data === true;
  };
  if (!(await hit(`tg:${v.user.id}`, PER_USER))) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(PER_USER.seconds) });
  const known = await admin.from('users').select('id').eq('telegram_id', v.user.id).maybeSingle();
  if (known.error) return json({ error: 'users_select', detail: known.error.message }, 500);
  if (!known.data && !(await hit('new_users', NEW_USERS))) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(NEW_USERS.seconds) });

  // 1) пользователь Auth: создаём, если нет (повторный вход получит ошибку «уже есть» — это нормально)
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { telegram_id: v.user.id, name } });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) return json({ error: 'auth_create', detail: created.error.message }, 500);

  // 2) одноразовая ссылка → токен, который клиент обменяет на сессию
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error || !link.data?.properties?.hashed_token) return json({ error: 'auth_link', detail: link.error?.message }, 500);
  const authId = link.data.user.id;

  // 3) строка users с тем же id (на неё смотрят RLS-функции: sub = users.id)
  const { data: row, error: selErr } = await admin.from('users').select('id').eq('telegram_id', v.user.id).maybeSingle();
  if (selErr) return json({ error: 'users_select', detail: selErr.message }, 500);
  if (row && row.id !== authId) return json({ error: 'identity_mismatch' }, 409); // строка заведена раньше с другим id — разбирает администратор
  if (!row) {
    const { error: insErr } = await admin.from('users').insert({ id: authId, telegram_id: v.user.id, display_name: name });
    if (insErr) return json({ error: 'users_insert', detail: insErr.message }, 500);
  }
  return json({ token_hash: link.data.properties.hashed_token, email });
}
