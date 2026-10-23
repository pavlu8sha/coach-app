-- Импорт истории посещаемости (листы месяцев ATT_ID).
-- Тренировка группы за день = одна строка sessions; ключ source_key делает повторный импорт безопасным.
alter table sessions add column if not exists source_key text;
alter table sessions add constraint sessions_source_unique unique (group_id, source_key);

-- Права для сервисного ключа (импорт). Строки по-прежнему ограничивает RLS для обычных пользователей.
grant select, insert, update, delete on sessions, attendance to service_role;
