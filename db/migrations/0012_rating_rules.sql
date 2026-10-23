-- Рейтинг: правила начисления (docs/RATING_SPEC.md) и перенос истории в point_events.
-- Одно начисление за одно событие и одно правило: повторный запуск переноса не задваивает баллы.
alter table point_events add constraint point_events_source_unique unique (player_id, rule_id, source_type, source_id);

-- Права для сервисного ключа (перенос). Обычным пользователям — как в 0002: журнал баллов только чтение и добавление.
grant select, insert, update, delete on rules, point_events to service_role;
grant select on sessions, attendance, matches, match_players to service_role;
