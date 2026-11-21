// Отправка накопленных уведомлений ботом (очередь notifications, миграция 0026). Вызывается по расписанию (раз в минуту).
// Секреты функции: TELEGRAM_BOT_TOKEN (уже задан), NOTIFY_SECRET (случайная строка; её же кладёт в заголовок x-notify-secret
// планировщик). Необязательно: MINI_APP_URL. Деплой с --no-verify-jwt: планировщик не присылает ключ Supabase.
// Сообщения только подтверждения и решения по запросам; текст готовит база, функция его не меняет. См. docs/NOTIFICATIONS.md.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildCall, classify } from './notify-logic.js';

const APP_URL = Deno.env.get('MINI_APP_URL') ?? 'https://coach-app-84b.pages.dev/';
const TELEGRAM_TIMEOUT_MS = Number(Deno.env.get('TELEGRAM_TIMEOUT_MS') ?? '15000');
const BATCH_BUDGET_MS = Number(Deno.env.get('NOTIFY_BATCH_BUDGET_MS') ?? '90000');

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
    const rows = (claimed.data ?? []) as { id: string; telegram_id: number; text: string; buttons?: { text: string; data: string }[][] | null; claim_token?: string | null }[];
    let sent = 0, failed = 0, released = 0;
    const startedAt = Date.now();
    const releaseFrom = async (from: number, claimToken: string | null) => {
      const ids = rows.slice(from).map(r => r.id);
      if (ids.length === 0 || !claimToken) return 0;
      const rel = await admin.rpc('release_notifications', { ids, token: claimToken });
      if (rel.error) {
        console.error('release_notifications', rel.error.message);
        return 0;
      }
      return Number(rel.data ?? 0);
    };
    for (const [idx, n] of rows.entries()) {
      const claimToken = n.claim_token ?? null;
      // Строка без токена уже не наша либо создана в обход claim_notifications: не отправляем и не трогаем.
      if (!claimToken) continue;
      // Не начинаем запрос, если его полный timeout уже не помещается в бюджет пачки.
      if (Date.now() - startedAt + TELEGRAM_TIMEOUT_MS > BATCH_BUDGET_MS) {
        released = await releaseFrom(idx, claimToken);
        break;
      }
      // Продлеваем закрепление перед каждым запросом: даже долгая отправка не отдаёт строку другому запуску.
      const ren = await admin.rpc('renew_notifications', { i: n.id, token: claimToken });
      if (ren.error) {
        console.error('renew_notifications', ren.error.message);
        released = await releaseFrom(idx, claimToken);
        break;
      }
      if (ren.data !== true) {
        // За время обработки строку забрал другой запуск. Его finish/release не перебиваем.
        continue;
      }
      const call = buildCall(n, APP_URL);
      let res: { ok: boolean; giveUp: boolean; stop: boolean; error: string | null };
      try {
        const r = await fetch(`${Deno.env.get('TELEGRAM_API_BASE') ?? 'https://api.telegram.org'}/bot${token}/${call.method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(call.body), signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS) });
        res = classify(r.status, r.ok ? '' : await r.text());
      } catch (e) {
        res = { ok: false, giveUp: false, stop: false, error: e instanceof Error ? e.message : String(e) };
      }
      const fin = await admin.rpc('finish_notification', { i: n.id, ok: res.ok, err: res.error, give_up: res.giveUp, token: claimToken });
      if (fin.error) console.error('finish_notification', fin.error.message);
      else if (fin.data === false) console.warn('finish_notification: lease lost', n.id);
      if (res.ok) sent++; else failed++;
      if (res.stop) {
        // Telegram просит притормозить: необработанные строки возвращаем без потери попытки (0184, REL-02),
        // иначе после трёх таких пачек они закрывались бы как зависшие. Следующий запуск заберёт их снова.
        // Токен своей выдачи: release не снимает строки, которые уже забрал другой запуск.
        released = await releaseFrom(idx + 1, claimToken);
        break;
      }
    }
    return new Response(JSON.stringify({ claimed: rows.length, sent, failed, released }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('tg-notify', e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
