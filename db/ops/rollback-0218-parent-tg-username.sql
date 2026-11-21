-- Откат 0218: убрать функцию и колонку ника. Остальные данные и права не затрагиваются.
-- Приложение без них показывает у родителя подсказку «Ника в Telegram нет…» вместо кнопки.
drop function if exists group_parent_usernames(uuid);
alter table users drop column if exists telegram_username;
