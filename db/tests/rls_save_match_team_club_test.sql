-- pgTAP: save_match_team создаёт матч в клубе текущего администратора, а не в первом по id (0225). Решение владельца 2026-11-26:
-- у каждого клуба свой администратор, он создаёт матч в своём клубе. Условия: docs/REMOVE_MATCH_PLAYER_CLUB_ACCEPTANCE.md, раздел save_match_team. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(16);

alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
drop function save_match_team(text, date, text, int, int, jsonb);
\i db/migrations/0225_remove_match_player_club.sql

insert into clubs (id, name) values
  ('00000000-0000-0000-0000-00000000c001', 'Клуб А'),
  ('00000000-0000-0000-0000-00000000c002', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000a1', 8101, 'Админ А', true,  '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000a2', 8102, 'Админ Б', true,  '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000a3', 8103, 'Админ без клуба', true, null),
  ('00000000-0000-0000-0000-0000000000c1', 8104, 'Тренер А', false, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000b1', 8105, 'Родитель', false, '00000000-0000-0000-0000-00000000c001');
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select ok(has_function_privilege('authenticated', 'save_match_team(text,date,text,integer,integer,jsonb)', 'execute'), 'authenticated вызывает функцию');
select ok(not has_function_privilege('anon', 'save_match_team(text,date,text,integer,integer,jsonb)', 'execute'), 'anon не вызывает функцию (при умолчаниях Supabase)');
select ok((select p.proconfig @> array['search_path=public, pg_temp'] from pg_proc p where p.oid = 'save_match_team(text,date,text,integer,integer,jsonb)'::regprocedure), 'search_path public, pg_temp');

-- администратор клуба Б создаёт матч в клубе Б (раньше: в первом по id клубе А)
select as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select save_match_team('U12 Б', '2026-11-05', 'Соперник', null, null, '[]'::jsonb)$$, 'администратор клуба Б создаёт командный матч');
reset role;
select is((select club_id from matches where team = 'U12 Б'), '00000000-0000-0000-0000-00000000c002'::uuid, 'матч создан в клубе Б');

-- администратор клуба А создаёт матч в клубе А
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select save_match_team('U12 А', '2026-11-05', 'Соперник', null, null, '[]'::jsonb)$$, 'администратор клуба А создаёт командный матч');
reset role;
select is((select club_id from matches where team = 'U12 А'), '00000000-0000-0000-0000-00000000c001'::uuid, 'матч создан в клубе А');

-- администратор с неопределимым клубом при двух клубах: клуб выбрать нельзя, матч не создаётся
select as_user('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select save_match_team('U12 X', '2026-11-05', 'Соперник', null, null, '[]'::jsonb)$$, '42501', 'forbidden', 'администратор без клуба при двух клубах: отказ');
reset role;
select is((select count(*)::int from matches where team = 'U12 X'), 0, 'матч не создан');

-- тренер и родитель
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select save_match_team('U12 Т', '2026-11-05', 'Соперник', null, null, '[]'::jsonb)$$, '42501', 'forbidden', 'тренер не создаёт командный матч');
reset role;
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select save_match_team('U12 Р', '2026-11-05', 'Соперник', null, null, '[]'::jsonb)$$, '42501', 'forbidden', 'родитель не создаёт командный матч');
reset role;
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', '{}', true);
select throws_ok($$select save_match_team('U12 Н', '2026-11-05', 'Соперник', null, null, '[]'::jsonb)$$, '42501', 'not authenticated', 'без входа отказ');
reset role;

-- подмена pg_temp.users: администратор Б «переселяется» в клуб А
discard plans;
select as_user('00000000-0000-0000-0000-0000000000a2');
create temp table users (like public.users including defaults);
insert into pg_temp.users (id, telegram_id, club_id, is_admin) values ('00000000-0000-0000-0000-0000000000a2', 9, '00000000-0000-0000-0000-00000000c001', true);
select lives_ok($$select save_match_team('U12 Б2', '2026-11-06', 'Соперник', null, null, '[]'::jsonb)$$, 'подмена pg_temp.users: матч создаётся');
drop table pg_temp.users;
reset role;
select is((select club_id from matches where team = 'U12 Б2'), '00000000-0000-0000-0000-00000000c002'::uuid, 'подмена pg_temp.users не сменила клуб матча');

-- единственный клуб: администратор без club_id создаёт матч в нём (прежнее поведение при одном клубе)
update users set club_id = null where club_id = '00000000-0000-0000-0000-00000000c002';
delete from matches where club_id = '00000000-0000-0000-0000-00000000c002';
delete from clubs where id = '00000000-0000-0000-0000-00000000c002';
select as_user('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select save_match_team('U12 Один', '2026-11-07', 'Соперник', null, null, '[]'::jsonb)$$, 'один клуб: администратор без club_id создаёт матч');
reset role;
select is((select club_id from matches where team = 'U12 Один'), '00000000-0000-0000-0000-00000000c001'::uuid, 'матч создан в единственном клубе');

select * from finish();
rollback;
