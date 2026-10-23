# Вход через Telegram (Edge Function `tg-auth`)

Клиент (Mini App) отправляет `initData` → функция проверяет подпись → заводит пользователя в Supabase Auth и в `users`
(одинаковый id) → возвращает `token_hash`. Клиент обменивает его на обычную сессию Supabase:

```js
const r = await fetch(`${SUPABASE_URL}/functions/v1/tg-auth`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY }, body: JSON.stringify({ initData: Telegram.WebApp.initData }) });
const { token_hash } = await r.json();
await supabase.auth.verifyOtp({ token_hash, type: 'email' });   // дальше работают RLS (sub = users.id)
```

Своих JWT функция не подписывает: у проекта асимметричные ключи подписи (проверено по JWKS), поэтому сессию выдаёт Supabase.

## Проверка на staging (не сделана)
1. Бот в @BotFather; токен — в секреты функции: `supabase secrets set TELEGRAM_BOT_TOKEN=...` (в чат и в репозиторий не класть).
2. `supabase functions deploy tg-auth --no-verify-jwt` (функция вызывается до входа). Включить в проекте провайдер Email.
3. Открыть Mini App с телефона, убедиться, что `verifyOtp` вернул сессию, а `select current_user_id()` в SQL от этого пользователя равен `users.id`.
4. Проверить подделку: изменённый `initData` → 401.

## Ограничения
- Войти может любой пользователь Telegram, но без связи с ребёнком (`player_guardians`) и без роли RLS ничего не покажет. Нужны ограничение частоты запросов и подтверждение связи администратором.
- Если строка `users` с этим `telegram_id` заведена раньше с другим id, функция вернёт 409 `identity_mismatch`.
