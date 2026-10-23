// Webhook бота клуба: приветствие после /start и «что важно знать» (логика — bot-logic.js).
// Секреты функции: TELEGRAM_BOT_TOKEN (уже задан для tg-auth), TELEGRAM_WEBHOOK_SECRET (случайная строка; та же передаётся
// в setWebhook как secret_token — Telegram шлёт её в заголовке X-Telegram-Bot-Api-Secret-Token). Необязательно: MINI_APP_URL.
// Деплой с --no-verify-jwt: Telegram не присылает ключ Supabase. См. README.md.
import { route } from './bot-logic.js';

const APP_URL = Deno.env.get('MINI_APP_URL') ?? 'https://coach-app-84b.pages.dev/';

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
    for (const call of route(update, APP_URL)) {
      const r = await fetch(`${Deno.env.get('TELEGRAM_API_BASE') ?? 'https://api.telegram.org'}/bot${token}/${call.method}`, {
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
