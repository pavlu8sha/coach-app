-- pgTAP: границы статусов preflight для миграций, которые нельзя определять по одному признаку.
-- Каждый DDL выполняется в подтранзакции helper-функции sub() и откатывается, production не затрагивается.
\set pf `cat db/ops/preflight.sql`
begin;
create extension if not exists pgtap;
select plan(29);

create temp view pf as :pf;

create function sub(ddl text, q text) returns text language plpgsql as $$
declare r text;
begin
  begin
    execute ddl; execute q into r;
    raise exception '%', coalesce(r, '<null>') using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then return sqlerrm;
  end;
end $$;

create function st(m text) returns text language sql as $$
  select status from pf where migration = m
$$;

create function sst(ddl text, m text) returns text language plpgsql as $$
begin
  return sub(ddl, format('select status from pf where migration = %L', m));
end $$;

-- 0030: APPLIED только после отзыва EXECUTE; отсутствие функции не должно давать ошибку.
select is(st('0030_revoke_trigger_function'), 'APPLIED', '0030: текущее состояние APPLIED');
select is(sst('grant execute on function notify_data_request() to authenticated', '0030_revoke_trigger_function'), 'NOT_APPLIED', '0030: EXECUTE у authenticated = NOT_APPLIED');
select is(sst('alter function notify_data_request() rename to notify_data_request_x', '0030_revoke_trigger_function'), 'NOT_APPLIED', '0030: функции нет = NOT_APPLIED без ошибки');

-- 0047: после 0150 старая 4-аргументная сигнатура отсутствует, но миграция перекрыта.
select is(st('0047_ind_no_autobook'), 'SUPERSEDED', '0047: после 0150 SUPERSEDED');
select is(sst($ddl$create function ind_create_session(date, time, boolean, text) returns uuid language sql as 'select null::uuid'$ddl$, '0047_ind_no_autobook'), 'APPLIED', '0047: старая сигнатура без individual_regulars = APPLIED');

-- 0052: аналогично 0047, проверяем и тело старой сигнатуры.
select is(st('0052_ind_change_type'), 'SUPERSEDED', '0052: после 0150 SUPERSEDED');
select is(sst($ddl$create function ind_edit_session(uuid, date, time, text, boolean) returns void language plpgsql as $body$ begin /* goalkeepers = new_gk */ return; end $body$$ddl$, '0052_ind_change_type'), 'APPLIED', '0052: старая сигнатура с goalkeepers = new_gk = APPLIED');

-- 0081: старый overload есть = NOT_APPLIED; после 0060 его нет = SUPERSEDED.
select is(st('0081_match_stats_drop_old_overload'), 'SUPERSEDED', '0081: после 0060 SUPERSEDED');
select is(sst($ddl$create function match_stats(date, date) returns void language plpgsql as $body$ begin return; end $body$$ddl$, '0081_match_stats_drop_old_overload'), 'NOT_APPLIED', '0081: старый overload вернулся = NOT_APPLIED');

-- 0091: после 0094 event_roster больше не читает match_players = SUPERSEDED.
select is(st('0091_event_list_players_count'), 'SUPERSEDED', '0091: после 0094 SUPERSEDED');
select is(sst($ddl$create or replace function event_roster(t uuid) returns table (player_id uuid, full_name text, group_name text) language plpgsql stable security definer set search_path = public as $body$ begin perform event_assert_staff(); return query select p.id, p.full_name, g.name from players p left join groups g on g.id = p.group_id where p.id in (select f.player_id from tournament_fees f where f.tournament_id = t) or p.id in (select mp.player_id from match_players mp join matches m on m.id = mp.match_id where m.tournament_id = t); end $body$$ddl$, '0091_event_list_players_count'), 'APPLIED', '0091: event_roster с match_players = APPLIED');

-- 0150: booking_conflicts создаётся этой миграцией.
select is(st('0150_individual_times'), 'APPLIED', '0150: текущее состояние APPLIED');
select is(sst('alter function booking_conflicts(text, uuid, uuid) rename to booking_conflicts_x', '0150_individual_times'), 'NOT_APPLIED', '0150: booking_conflicts отсутствует = NOT_APPLIED');

-- 0165: пять триггеров и отозванные права.
select is(st('0165_camp_history_immutable'), 'APPLIED', '0165: текущее состояние APPLIED');
select is(sst('drop trigger camp_payments_immutable on camp_payments', '0165_camp_history_immutable'), 'NOT_APPLIED', '0165: нет триггера = NOT_APPLIED');

-- 0168: EXECUTE у authenticated, но не у anon.
select is(st('0168_match_duration_setting'), 'APPLIED', '0168: текущее состояние APPLIED');
select is(sst('revoke execute on function match_duration_minutes() from authenticated', '0168_match_duration_setting'), 'NOT_APPLIED', '0168: EXECUTE отозван у authenticated = NOT_APPLIED');
select is(sst('grant execute on function match_duration_minutes() to anon', '0168_match_duration_setting'), 'NOT_APPLIED', '0168: EXECUTE выдан anon = NOT_APPLIED');

-- 0171: authenticated не может delete, но может insert/update.
select is(st('0171_individual_template_admin'), 'APPLIED', '0171: текущее состояние APPLIED');
select is(sst('grant delete on individual_templates to authenticated', '0171_individual_template_admin'), 'NOT_APPLIED', '0171: delete выдан = NOT_APPLIED');
select is(sst('revoke insert on individual_templates from authenticated', '0171_individual_template_admin'), 'NOT_APPLIED', '0171: insert отозван = NOT_APPLIED');

-- 0173: базовая проверка + четыре обновлённые функции + отсутствие посторонних consent_revoked_at.
select is(st('0173_consent_access'), 'APPLIED', '0173: текущее состояние APPLIED');
select is(sst($ddl$create function bad_consent_probe() returns text language sql as 'select ''consent_revoked_at''::text'$ddl$, '0173_consent_access'), 'UNKNOWN', '0173: посторонняя функция с consent_revoked_at = UNKNOWN');
select is(sst('alter function decide_link(uuid, boolean) rename to decide_link_x', '0173_consent_access'), 'NOT_APPLIED', '0173: одна из четырёх функций не обновлена = NOT_APPLIED');
select is(sst($ddl$create function parent_access_ok(text, text) returns boolean language sql as 'select true /* consent_revoked_at */'$ddl$, '0173_consent_access'), 'UNKNOWN', '0173: лишний overload с тем же именем = UNKNOWN, не APPLIED');
select is(sst($ddl$do $do$ begin
  execute $q$create or replace function parent_access_ok(parent uuid, player uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $body$select false$body$$q$;
  execute $q$create function parent_access_ok(text, text) returns boolean language sql as $body$select true /* consent_revoked_at */$body$$q$;
end $do$$ddl$, '0173_consent_access'), 'NOT_APPLIED', '0173: ожидаемая сигнатура не обновлена, остался overload с токеном = NOT_APPLIED');
select is(sst('drop trigger consent_mode_guard on club_settings', '0173_consent_access'), 'NOT_APPLIED', '0173: нет consent_mode_guard = NOT_APPLIED');

-- 0176: статус и note должны оставаться согласованными.
select is(st('0176_consent_claim_check'), 'APPLIED', '0176: текущее состояние APPLIED');
select is((select note from pf where migration = '0176_consent_claim_check'), 'applied', '0176: note = applied');

select * from finish();
rollback;
