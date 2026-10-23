# Бот клуба (Edge Function `tg-bot`)

Отвечает на `/start` приветствием с кнопкой «Далее», затем присылает сообщение «Перед началом…» с кнопками «Наш канал» и «Открыть приложение». На любой другой текст в личном чате отвечает кнопкой «Открыть приложение». Тексты и ссылка на канал: `bot-logic.js`.

## Включение (делает владелец, PowerShell)
1. Придумать случайную строку (буквы и цифры, до 256 знаков) и записать в секрет функции: `npx.cmd supabase@latest secrets set TELEGRAM_WEBHOOK_SECRET=<строка> --project-ref ypxbwhjsqkrciozdhajf`. `TELEGRAM_BOT_TOKEN` уже задан для `tg-auth`.
2. Деплой: `npx.cmd supabase@latest functions deploy tg-bot --no-verify-jwt --project-ref ypxbwhjsqkrciozdhajf`.
3. Привязать бота к функции (токен бота ввести в `Read-Host`, в чат не присылать):
   ```powershell
   $t = Read-Host "Токен бота"; $s = Read-Host "Секрет вебхука"
   Invoke-RestMethod "https://api.telegram.org/bot$t/setWebhook" -Method Post -ContentType 'application/json' -Body (@{ url = 'https://ypxbwhjsqkrciozdhajf.supabase.co/functions/v1/tg-bot'; secret_token = $s; allowed_updates = @('message','callback_query') } | ConvertTo-Json)
   ```
4. Написать боту `/start` и проверить два сообщения.

## Важно
- Telegram держит у бота **один** webhook. Если бот сейчас работает через Apps Script, после `setWebhook` его старые команды перестанут отвечать. Откат: снова вызвать `setWebhook` с адресом старого скрипта или `deleteWebhook`.
- Кнопка меню бота (Mini App) в BotFather не меняется.
- Функция не пишет в базу и не читает её.
