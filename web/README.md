# Приложение для родителей (Telegram Mini App + веб)

Vite + React + TypeScript + supabase-js. Один код для Telegram Mini App и браузера.

Сейчас: вход через Telegram (`supabase/functions/tg-auth`) и экран «Мой ребёнок» (дети, баллы рейтинга). Вход из обычного браузера — позже.

## Переменные окружения
- `VITE_SUPABASE_URL` — адрес проекта, без `/rest/v1`.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — публичный ключ `sb_publishable_…` (не секретный; доступ ограничивает RLS).

## Запуск и сборка
```
npm install
npm run dev      # локально
npm run build    # проверка типов и сборка в dist/
```

## Cloudflare Pages
Корень проекта: `web`; команда сборки: `npm install && npm run build`; папка результата: `dist`; переменные — две выше.
Адрес готовой страницы указывается в @BotFather: бот → Bot Settings → Menu Button (или /newapp для Mini App).
