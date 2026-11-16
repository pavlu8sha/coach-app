-- ОТКАТ 0202 (раздел «Мероприятия», этап 1): удаляет функции и таблицы мероприятий.
-- Защита: откат отказывает, если в таблицах есть данные (журналы только добавляются). Сначала db/ops/preflight.sql; данные сохранить выгрузкой.
begin;
do $$
begin
  if exists (select 1 from club_events) or exists (select 1 from club_event_log) or exists (select 1 from club_event_price_log) then
    raise exception 'club_events has data: export and clean up before rollback';
  end if;
end $$;
drop function if exists club_event_create(text, text, date, time, text, numeric, timestamp, int, uuid[], text);
drop function if exists club_event_update(uuid, jsonb, text, boolean);
drop function if exists club_event_set_status(uuid, text);
drop function if exists club_event_list(text);
drop function if exists club_event_get(uuid);
drop function if exists club_event_history(uuid);
drop function if exists club_event_groups_check(uuid, uuid[]);
drop function if exists club_event_log_add(uuid, text, jsonb, jsonb);
drop function if exists club_event_snapshot(uuid);
drop function if exists club_event_isolation_ok();
drop function if exists club_event_assert_admin();
drop table if exists club_event_price_log, club_event_log, club_event_groups, club_events cascade;
drop function if exists club_event_current_club();
drop function if exists club_event_guard();
commit;
