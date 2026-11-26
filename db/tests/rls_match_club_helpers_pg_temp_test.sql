-- pgTAP: helper-функции проверки клуба и роли не подменяются через pg_temp (0225, ревью #830 P1).
-- club_event_current_club() читает users, is_any_coach() читает coach_groups: подмена pg_temp.users / pg_temp.coach_groups
-- не должна давать обход проверки клуба в remove_match_player, save_match, set_match_technical, delete_match. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(24);

alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0225_remove_match_player_club.sql

insert into clubs (id, name) values
  ('00000000-0000-0000-0000-00000000c001', 'Клуб А'),
  ('00000000-0000-0000-0000-00000000c002', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000a2', 8002, 'Админ Б', true,  '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000c2', 8004, 'Тренер Б', false, '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000b1', 8005, 'Родитель А', false, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000c3', 8006, 'Тренер без клуба', false, null);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c002', 'U9');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок А1');
insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-11-01', 'U9', 'Соперник А');
insert into match_players (match_id, player_id, played, goals, best) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', true, 0, false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- конфигурация и права helper-функций
select ok((select p.proconfig @> array['search_path=public, pg_temp'] from pg_proc p where p.oid = 'club_event_current_club()'::regprocedure), 'club_event_current_club: search_path public, pg_temp');
select ok((select p.proconfig @> array['search_path=public, pg_temp'] from pg_proc p where p.oid = 'is_any_coach()'::regprocedure), 'is_any_coach: search_path public, pg_temp');
select ok(has_function_privilege('authenticated', 'club_event_current_club()', 'execute') and not has_function_privilege('anon', 'club_event_current_club()', 'execute'), 'club_event_current_club: права authenticated, не anon');
select ok(has_function_privilege('authenticated', 'is_any_coach()', 'execute') and not has_function_privilege('anon', 'is_any_coach()', 'execute'), 'is_any_coach: права authenticated, не anon');

select ok(position('public.users' in (select prosrc from pg_proc where oid = 'club_event_current_club()'::regprocedure)) > 0 and position('public.clubs' in (select prosrc from pg_proc where oid = 'club_event_current_club()'::regprocedure)) > 0, 'club_event_current_club: users и clubs квалифицированы public.');
select ok(position('public.coach_groups' in (select prosrc from pg_proc where oid = 'is_any_coach()'::regprocedure)) > 0, 'is_any_coach: coach_groups квалифицирована public.');

-- A. подмена pg_temp.users: тренер клуба Б «переселяет» себя в клуб А
discard plans;
select as_user('00000000-0000-0000-0000-0000000000c2');
create temp table users (like public.users including defaults);
insert into pg_temp.users (id, telegram_id, club_id) values ('00000000-0000-0000-0000-0000000000c2', 1, '00000000-0000-0000-0000-00000000c001');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'pg_temp.users: remove_match_player отказ');
select throws_ok($$select save_match('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'Взлом', null, null, '[]'::jsonb)$$, '42501', 'forbidden', 'pg_temp.users: save_match отказ');
select throws_ok($$select set_match_technical('00000000-0000-0000-0000-0000000000f1', true)$$, '42501', 'forbidden', 'pg_temp.users: set_match_technical отказ');
drop table pg_temp.users;
reset role;
select as_user('00000000-0000-0000-0000-0000000000a2');
create temp table users (like public.users including defaults);
insert into pg_temp.users (id, telegram_id, club_id, is_admin) values ('00000000-0000-0000-0000-0000000000a2', 2, '00000000-0000-0000-0000-00000000c001', true);
select throws_ok($$select delete_match('00000000-0000-0000-0000-0000000000f1')$$, '42501', 'forbidden', 'pg_temp.users: delete_match отказ');
drop table pg_temp.users;
reset role;

-- B. подмена pg_temp.coach_groups: родитель выдаёт себя за тренера своего клуба
discard plans;
select as_user('00000000-0000-0000-0000-0000000000b1');
create temp table coach_groups (like public.coach_groups including defaults);
insert into pg_temp.coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'pg_temp.coach_groups: remove_match_player отказ');
select throws_ok($$select save_match('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'Взлом', null, null, '[]'::jsonb)$$, '42501', 'forbidden', 'pg_temp.coach_groups: save_match отказ');
select throws_ok($$select set_match_technical('00000000-0000-0000-0000-0000000000f1', true)$$, '42501', 'forbidden', 'pg_temp.coach_groups: set_match_technical отказ');
drop table pg_temp.coach_groups;
reset role;

-- C. подмена pg_temp.clubs: тренер без club_id при двух клубах; во временной clubs ровно одна строка (клуб А), fallback «единственный клуб» не должен сработать
discard plans;
select as_user('00000000-0000-0000-0000-0000000000c3');
create temp table clubs (like public.clubs including defaults);
insert into pg_temp.clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Подмена');
select is(club_event_current_club(), null::uuid, 'pg_temp.clubs: club_event_current_club не использует подменённую clubs');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'pg_temp.clubs: remove_match_player отказ');
select throws_ok($$select save_match('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-11-01', 'Взлом', null, null, '[]'::jsonb)$$, '42501', 'forbidden', 'pg_temp.clubs: save_match отказ');
select throws_ok($$select set_match_technical('00000000-0000-0000-0000-0000000000f1', true)$$, '42501', 'forbidden', 'pg_temp.clubs: set_match_technical отказ');
drop table pg_temp.clubs;
reset role;

-- данные не тронуты
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1'), 1, 'состав матча цел');
select is((select technical from matches where id = '00000000-0000-0000-0000-0000000000f1'), false, 'флаг «технический» не изменён');
select is((select opponent from matches where id = '00000000-0000-0000-0000-0000000000f1'), 'Соперник А', 'матч не изменён');
select is((select count(*)::int from matches where id = '00000000-0000-0000-0000-0000000000f1'), 1, 'матч не удалён');

-- обычная работа не сломана: тренер клуба Б в своём клубе, родитель не тренер
select as_user('00000000-0000-0000-0000-0000000000c2');
select is(is_any_coach(), true, 'is_any_coach: настоящий тренер');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(is_any_coach(), false, 'is_any_coach: родитель не тренер');
select is(club_event_current_club(), '00000000-0000-0000-0000-00000000c001'::uuid, 'club_event_current_club: клуб из users');
reset role;

select * from finish();
rollback;
