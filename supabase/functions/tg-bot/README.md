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

## Заявки «Хочу в KickStart» (по умолчанию выключено)
Под сообщением «Перед началом…» появляется кнопка «Хочу в KickStart». Диалог (`lead-logic.js`): согласие на обработку данных → имя и фамилия ребёнка → год рождения → телефон родителя (кнопка «Отправить мой номер» или текст) → проверка → «Отправить». Заявка попадает администратору (приложение: «Ещё → Заявки», плюс сообщение от бота) и в таблицу `trials`.
Включение (после слияния и применения миграции `0039_bot_leads.sql`, делает владелец):
1. Секрет функции: `npx.cmd supabase@latest secrets set LEADS_ENABLED=1 --project-ref ypxbwhjsqkrciozdhajf` (`SUPABASE_URL` и ключ службы Supabase в функцию подставляются автоматически).
2. Повторный деплой: `npx.cmd supabase@latest functions deploy tg-bot --no-verify-jwt --project-ref ypxbwhjsqkrciozdhajf`.
3. Отключить: `secrets unset LEADS_ENABLED` и повторный деплой.
Защита: не больше 3 заявок в сутки с одного Telegram; повтор той же заявки новой не создаёт; черновики диалога видит только служебная роль и они удаляются через двое суток. **Перед включением текст согласия (`CONSENT` в `lead-logic.js`) должен пройти юридическую проверку.**
