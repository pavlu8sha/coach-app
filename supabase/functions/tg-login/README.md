# Вход из обычного браузера (Edge Function `tg-login`)

Для родителей без Telegram на телефоне или тех, кто открывает сайт в браузере. Вход всё равно через Telegram-аккаунт (виджет
Telegram Login), поэтому это **тот же пользователь**, что и в Mini App: те же дети, тот же доступ.

Клиент получает от виджета данные пользователя с подписью и отправляет их сюда → функция проверяет подпись токеном бота
(`login-widget.js`), заводит пользователя в Supabase Auth и в `users` (как `tg-auth`), возвращает `token_hash`:

```js
const r = await fetch(`${SUPABASE_URL}/functions/v1/tg-login`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY }, body: JSON.stringify({ auth: widgetUser }) });
const { token_hash } = await r.json();
await supabase.auth.verifyOtp({ token_hash, type: 'email' });
```

## Что нужно сделать владельцу (один раз)
1. В @BotFather: `/setdomain` → выбрать бота → указать домен сайта (`coach-app-84b.pages.dev`). Без этого виджет не покажется.
2. Развернуть функцию (секрет `TELEGRAM_BOT_TOKEN` уже задан у проекта):
   `npx.cmd supabase@latest functions deploy tg-login --no-verify-jwt --project-ref ypxbwhjsqkrciozdhajf`
3. В Cloudflare Pages → Settings → Variables добавить `VITE_TG_BOT_USERNAME` = имя бота без `@` и пересобрать сайт. Пока переменной нет, сайт в браузере по-прежнему просит открыть его из Telegram.

## Безопасность
- Подпись проверяется на сервере; срок жизни подписи 1 час; будущая дата и подмена любого поля отклоняются (тесты `tests/edge/login-widget.test.mjs`).
- Те же ограничения частоты, что у `tg-auth` (`rate_limits`, миграция 0016): 10 входов за 10 минут с одного Telegram-аккаунта и 30 новых аккаунтов в час.
- Как и в `tg-auth`, вошедший без связи с ребёнком и без роли ничего не увидит.
- `ALLOWED_ORIGIN` (необязательный секрет) ограничивает CORS одним доменом.

## Не проверено
Функция не запускалась на живом проекте и в Deno: логика подписи покрыта тестами в Node, остальное повторяет `tg-auth`.
