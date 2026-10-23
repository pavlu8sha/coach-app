# Тесты Edge Functions под Deno

Тесты запускают настоящие `index.ts` четырёх функций отдельными процессами
(`deno run`) и обращаются к ним по HTTP. Supabase и Telegram подменены
локальными HTTP-заглушками, боевые сервисы и реальные токены не используются.

Нужен Deno 2.x. Из корня репозитория:

```powershell
deno test --allow-env --allow-net --allow-read --allow-run tests/deno/
```

Что покрыто:

- `tg-auth`: CORS/OPTIONS, неверная и просроченная подпись без обращения к
  Supabase, создание пользователя и ссылки, запись `users`, лимиты 429, сбой
  лимитера, конфликт `identity_mismatch` 409, ошибки Supabase.
- `tg-login`: вход через Telegram Login Widget, подмена полей, просроченная
  подпись, создание пользователя, лимиты, конфликт и ошибки Supabase.
- `tg-notify`: проверка секрета, отправка очереди, `finish_notification`, ответы
  Telegram 403/429/500 и ошибка выборки очереди.
- `tg-bot`: проверка webhook-секрета, `/start`, callback `next`, группы,
  некорректный JSON и ответы Telegram 403/429/500.

Тесты используют выдуманные токены и переменные `SUPABASE_URL`,
`TELEGRAM_API_BASE`; наружу ходят только на `127.0.0.1`.
