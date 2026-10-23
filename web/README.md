# Приложение для родителей (Telegram Mini App + веб)

Vite + React + TypeScript + supabase-js. Один код для Telegram Mini App и браузера.

Вход: через Telegram Mini App (`supabase/functions/tg-auth`) и из обычного браузера через виджет Telegram Login (`supabase/functions/tg-login`, см. его README: нужны `/setdomain` в BotFather, деплой функции и переменная `VITE_TG_BOT_USERNAME`). Из браузера сайт можно добавить на главный экран (PWA: `public/manifest.webmanifest`, `public/sw.js` без кэширования).

## Переменные окружения
- `VITE_SUPABASE_URL` — адрес проекта, без `/rest/v1`.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — публичный ключ `sb_publishable_…` (не секретный; доступ ограничивает RLS).
- `VITE_TG_BOT_USERNAME` — (необязательно) имя бота без `@`: включает вход из обычного браузера. Без неё в браузере показывается просьба открыть из Telegram.

## Тесты экранов
`npm test` (Vitest + jsdom) запускает тесты экранов с заглушкой вместо Supabase (`src/test/fakeSupabase.ts`): данные задаются в тесте (`fake.db`), ответы функций базы — через `fake.rpc`, вызовы проверяются через `fake.rpcCalls(...)` и `fake.writes(...)`. Тесты проверяют логику (какие вызовы уходят в базу, подтверждения, сообщения об ошибках), а не вёрстку. Образец: `src/screens/Sessions.test.tsx`.

## Запуск и сборка
```
npm install
npm run dev      # локально
npm run build    # проверка типов и сборка в dist/
```

## Cloudflare Pages
Корень проекта: `web`; команда сборки: `npm install && npm run build`; папка результата: `dist`; переменные — две выше.
Адрес готовой страницы указывается в @BotFather: бот → Bot Settings → Menu Button (или /newapp для Mini App).
