-- Удаление тестовой записи на сбор: Starostenko Timofey (U10-A, статус «Отмена, отменил родитель»). 23.11.2026.
-- ВЫПОЛНЯЕТ ТОЛЬКО ПАВЕЛ, по шагам, после свежего preflight. История сборов защищена (0165, 0160), поэтому удаление идёт отдельным шагом от владельца базы.
-- Шаг 2 удаляет ровно одну строку по id из шага 1 и откатывается целиком, если у записи есть платежи, замена участника или иные связи.

-- ШАГ 1. Предпросмотр (только чтение): все записи Starostenko на сборах и всё, что к ним привязано.
select p.full_name, c.name as сбор, c.id::text as camp_id, cp.id::text as participant_id, cp.status, cp.amount,
  (select count(*) from camp_payments x where x.participant_id = cp.id) as платежей,
  (select coalesce(sum(x.amount), 0) from camp_payments x where x.participant_id = cp.id) as сумма_платежей,
  (select count(*) from camp_participant_events x where x.participant_id = cp.id) as событий,
  (select count(*) from camp_applications x where x.participant_id = cp.id) as заявок,
  (select count(*) from camp_participant_replacements x where x.old_participant_id = cp.id or x.new_participant_id = cp.id) as замен
  from camp_participants cp join players p on p.id = cp.player_id join camps c on c.id = cp.camp_id
 where p.full_name ilike 'Starostenko%'
 order by 1, 2;

-- ШАГ 2. Удаление одной тестовой записи: вставьте её participant_id в массив ids и camp_id (колонка camp_id из шага 1) в массив camps, по одному значению. Нужна точная запись: игрок «Starostenko Timofey», статус «cancelled», тот самый сбор.
do $$ declare ids uuid[] := array[]::uuid[]; camps uuid[] := array[]::uuid[]; n int; pay int; rep int; begin if coalesce(array_length(ids, 1), 0) <> 1 or coalesce(array_length(camps, 1), 0) <> 1 then raise exception 'вставьте ровно один participant_id в ids и один camp_id в camps (шаг 1)'; end if; if not exists (select 1 from camp_participants cp join players p on p.id = cp.player_id where cp.id = ids[1] and cp.camp_id = camps[1] and cp.status = 'cancelled' and p.full_name = 'Starostenko Timofey') then raise exception 'это не отменённая запись Starostenko Timofey на этом сборе: откат'; end if; select count(*) into pay from camp_payments where participant_id = ids[1]; if pay <> 0 then raise exception 'у записи % платежей: удалять нельзя, разберите их отдельно', pay; end if; select count(*) into rep from camp_participant_replacements where old_participant_id = ids[1] or new_participant_id = ids[1]; if rep <> 0 then raise exception 'запись участвует в замене участника: удалять нельзя'; end if; alter table camp_participant_events disable trigger camp_participant_events_no_change; alter table camp_participants disable trigger camp_participants_no_delete; delete from camp_participant_events where participant_id = ids[1]; update camp_applications set participant_id = null where participant_id = ids[1]; delete from camp_participants where id = ids[1]; get diagnostics n = row_count; if n <> 1 then raise exception 'удалено % строк, ожидалась 1: откат', n; end if; alter table camp_participant_events enable trigger camp_participant_events_no_change; alter table camp_participants enable trigger camp_participants_no_delete; raise notice 'тестовая запись удалена, триггеры включены'; end $$;

-- ШАГ 3. Проверка после шага 2: записей Starostenko на сборах не осталось (или осталась только настоящая), оба триггера включены (tgenabled = O).
select p.full_name, cp.status, cp.amount from camp_participants cp join players p on p.id = cp.player_id where p.full_name ilike 'Starostenko%';
select tgname, tgenabled from pg_trigger where tgname in ('camp_participant_events_no_change', 'camp_participants_no_delete') and not tgisinternal;
