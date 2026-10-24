// Отправка накопленных уведомлений ботом (очередь notifications, миграция 0026). Вызывается по расписанию (раз в минуту).
// Секреты функции: TELEGRAM_BOT_TOKEN (уже задан), NOTIFY_SECRET (случайная строка; её же кладёт в заголовок x-notify-secret
// планировщик). Необязательно: MINI_APP_URL. Деплой с --no-verify-jwt: планировщик не присылает ключ Supabase.
// Сообщения только подтверждения и решения по запросам; текст готовит база, функция его не меняет. См. docs/NOTIFICATIONS.md.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildCall, classify } from './notify-logic.js';

const APP_URL = Deno.env.get('MINI_APP_URL') ?? 'https://coach-app-84b.pages.dev/';

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('NOTIFY_SECRET') ?? '';
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  // без секрета функция закрыта: иначе любой мог бы запускать рассылку
  if (req.method !== 'POST' || !secret || !token || !same(req.headers.get('x-notify-secret') ?? '', secret)) return new Response('forbidden', { status: 403 });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const claimed = await admin.rpc('claim_notifications', { n: 20 });
    if (claimed.error) throw new Error(`claim: ${claimed.error.message}`);
    const rows = (claimed.data ?? []) as { id: string; telegram_id: number; text: string }[];
    let sent = 0, failed = 0;
    for (const n of rows) {
      const call = buildCall(n, APP_URL);
      let res: { ok: boolean; giveUp: boolean; stop: boolean; error: string | null };
      try {
        const r = await fetch(`${Deno.env.get('TELEGRAM_API_BASE') ?? 'https://api.telegram.org'}/bot${token}/${call.method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(call.body) });
        res = classify(r.status, r.ok ? '' : await r.text());
      } catch (e) {
        res = { ok: false, giveUp: false, stop: false, error: e instanceof Error ? e.message : String(e) };
      }
      const fin = await admin.rpc('finish_notification', { i: n.id, ok: res.ok, err: res.error, give_up: res.giveUp });
      if (fin.error) console.error('finish_notification', fin.error.message);
      if (res.ok) sent++; else failed++;
      if (res.stop) break; // Telegram просит притормозить: остальное заберёт следующий запуск
    }
    return new Response(JSON.stringify({ claimed: rows.length, sent, failed }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('tg-notify', e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
