// Webhook бота клуба: приветствие после /start и «что важно знать» (логика — bot-logic.js).
// Секреты функции: TELEGRAM_BOT_TOKEN (уже задан для tg-auth), TELEGRAM_WEBHOOK_SECRET (случайная строка; та же передаётся
// в setWebhook как secret_token — Telegram шлёт её в заголовке X-Telegram-Bot-Api-Secret-Token). Необязательно: MINI_APP_URL.
// Деплой с --no-verify-jwt: Telegram не присылает ключ Supabase. См. README.md.
import { route, BEFORE_START } from './bot-logic.js';
import { leadStep, withLeadButton } from './lead-logic.js';

const APP_URL = Deno.env.get('MINI_APP_URL') ?? 'https://coach-app-84b.pages.dev/';
// Заявки «Хочу в KickStart» (lead-logic.js): включаются LEADS_ENABLED=1 и требуют миграцию 0039 и ключ службы Supabase
const LEADS = Deno.env.get('LEADS_ENABLED') === '1';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const sb = (path: string, init: RequestInit = {}) =>
  fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

// Сравнение за время, не зависящее от места первого расхождения
const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  // без секрета функция закрыта: иначе любой мог бы слать ей «обновления»
  if (req.method !== 'POST' || !secret || !token || !same(req.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) {
    return new Response('forbidden', { status: 403 });
  }
  try {
    const update = await req.json();
    let calls = route(update, APP_URL);
    if (LEADS && SB_URL && SB_KEY) {
      const from = update?.message?.from ?? update?.callback_query?.from;
      const tg = from?.id;
      if (typeof tg === 'number') {
        const got = await sb(`lead_drafts?telegram_id=eq.${tg}&select=*`);
        const draft = got.ok ? ((await got.json())[0] ?? null) : null;
        const step = leadStep(update, draft);
        if (step) {
          calls = step.calls;
          if (step.submit) {
            const r = await sb('rpc/lead_submit', { method: 'POST', body: JSON.stringify(step.submit) });
            if (!r.ok) {
              console.error('lead_submit', r.status, (await r.text()).slice(0, 200));
              calls = [{ method: 'sendMessage', body: { chat_id: update.callback_query.message.chat.id, text: 'Не получилось отправить заявку. Попробуйте ещё раз позже или напишите администратору клуба.' } }];
            }
          } else if (step.draft) {
            await sb('lead_drafts?on_conflict=telegram_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ ...step.draft, telegram_id: tg, updated_at: new Date().toISOString() }) });
          } else {
            await sb(`lead_drafts?telegram_id=eq.${tg}`, { method: 'DELETE' });
          }
        } else {
          calls = withLeadButton(calls, BEFORE_START);
        }
      }
    }
    for (const call of calls) {
      const r = await fetch(`https://api.telegram.org/bot${token}/${call.method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(call.body),
      });
      if (!r.ok) console.error('telegram', call.method, r.status, (await r.text()).slice(0, 200));
    }
  } catch (e) {
    console.error('tg-bot', e instanceof Error ? e.message : String(e));
  }
  return new Response('ok'); // всегда 200, иначе Telegram будет повторять то же обновление
});
