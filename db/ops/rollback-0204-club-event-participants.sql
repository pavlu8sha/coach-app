-- ОТКАТ 0204 (раздел «Мероприятия», этап 2): удаляет функции участников и таблицы участников, возвращает club_event_update/list/get к телам из 0202.
-- Защита: откат отказывает, если есть записи участников или индивидуальные цены (журналы только добавляются). Сначала db/ops/preflight.sql; данные сохранить выгрузкой.
begin;
do $$
begin
  if exists (select 1 from club_event_participants) or exists (select 1 from club_event_participant_log) or exists (select 1 from club_event_price_log where participant_id is not null) then
    raise exception 'club_event_participants has data: export and clean up before rollback';
  end if;
end $$;
drop function if exists club_event_participant_add(uuid, uuid, boolean);
drop function if exists club_event_group_preview(uuid, uuid);
drop function if exists club_event_group_add(uuid, uuid);
drop function if exists club_event_participant_cancel(uuid);
drop function if exists club_event_participant_restore(uuid);
drop function if exists club_event_participant_set_price(uuid, numeric, text);
drop function if exists club_event_participants_list(uuid, text);
drop function if exists club_event_participant_history(uuid);
drop function if exists club_event_seat_guard(club_events);
alter table club_event_price_log drop constraint if exists club_event_price_log_participant_fk;
drop table if exists club_event_participant_log, club_event_participants cascade;
commit;
-- После отката повторно выполнить db/migrations/0202_club_events.sql (create or replace club_event_update, club_event_list, club_event_get вернёт тела этапа 1;
-- остальные объекты 0202 повторный запуск не меняет).
