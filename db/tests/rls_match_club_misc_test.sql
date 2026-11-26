-- pgTAP: set_match_technical и delete_match закрывают чужой клуб (0225). Условия: docs/REMOVE_MATCH_PLAYER_CLUB_ACCEPTANCE.md, раздел «set_match_technical и delete_match». Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(28);

alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- пересоздаём функции под умолчаниями Supabase (тела берутся из миграции 0225)
drop function set_match_technical(uuid, boolean);
drop function delete_match(uuid);
\i db/migrations/0225_remove_match_player_club.sql

insert into clubs (id, name) values
  ('00000000-0000-0000-0000-00000000c001', 'Клуб А'),
  ('00000000-0000-0000-0000-00000000c002', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000a1', 7901, 'Админ А', true,  '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000a2', 7902, 'Админ Б', true,  '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000a3', 7906, 'Админ без клуба', true, null),
  ('00000000-0000-0000-0000-0000000000c1', 7903, 'Тренер А', false, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000c2', 7904, 'Тренер Б', false, '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000c3', 7907, 'Тренер без клуба', false, null),
  ('00000000-0000-0000-0000-0000000000b1', 7905, 'Родитель', false, '00000000-0000-0000-0000-00000000c001');
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c002', 'U9');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок А1');
insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-11-01', 'U9', 'Соперник А'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c002', '2026-11-01', 'U9', 'Соперник Б'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000c002', '2026-11-02', 'U9', 'Соперник Б2');
insert into match_players (match_id, player_id, played, goals, best) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', true, 0, false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- права на базе с умолчаниями Supabase
select ok(has_function_privilege('authenticated', 'set_match_technical(uuid,boolean)', 'execute'), 'set_match_technical: authenticated вызывает');
select ok(not has_function_privilege('anon', 'set_match_technical(uuid,boolean)', 'execute'), 'set_match_technical: anon не вызывает');
select ok(has_function_privilege('authenticated', 'delete_match(uuid)', 'execute'), 'delete_match: authenticated вызывает');
select ok(not has_function_privilege('anon', 'delete_match(uuid)', 'execute'), 'delete_match: anon не вызывает');
select ok((select p.proconfig @> array['search_path=public, pg_temp'] from pg_proc p where p.oid = 'set_match_technical(uuid,boolean)'::regprocedure), 'set_match_technical: search_path public, pg_temp');
select ok((select p.proconfig @> array['search_path=public, pg_temp'] from pg_proc p where p.oid = 'delete_match(uuid)'::regprocedure), 'delete_match: search_path public, pg_temp');

-- set_match_technical: отказы
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select set_match_technical('00000000-0000-0000-0000-0000000000f1', true)$$, '42501', 'forbidden', 'тренер чужого клуба не меняет «технический»');
reset role;
select as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select set_match_technical('00000000-0000-0000-0000-0000000000f1', true)$$, '42501', 'forbidden', 'администратор чужого клуба не меняет «технический»');
reset role;
select as_user('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$select set_match_technical('00000000-0000-0000-0000-0000000000f1', true)$$, '42501', 'forbidden', 'тренер с неопределимым клубом получает отказ');
reset role;
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select set_match_technical('00000000-0000-0000-0000-0000000000f1', true)$$, '42501', 'forbidden', 'родитель не меняет «технический»');
reset role;
select is((select technical from matches where id = '00000000-0000-0000-0000-0000000000f1'), false, 'после отказов флаг не изменён');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select set_match_technical('00000000-0000-0000-0000-0000000000ff', true)$$, 'P0002', 'match not found', 'нет матча: прежняя ошибка');
reset role;

-- set_match_technical: подмена pg_temp.matches
discard plans;
select as_user('00000000-0000-0000-0000-0000000000c2');
create temp table matches (like public.matches including defaults);
insert into pg_temp.matches (id, club_id, played_on, team) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c002', '2026-11-01', 'U9');
select throws_ok($$select set_match_technical('00000000-0000-0000-0000-0000000000f1', true)$$, '42501', 'forbidden', 'set_match_technical: подмена pg_temp.matches не обходит клуб');
drop table pg_temp.matches;
reset role;
select is((select technical from matches where id = '00000000-0000-0000-0000-0000000000f1'), false, 'после попытки с pg_temp.matches флаг не изменён');

-- set_match_technical: свои
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select set_match_technical('00000000-0000-0000-0000-0000000000f1', true)$$, 'тренер своего клуба меняет «технический»');
reset role;
select is((select technical from matches where id = '00000000-0000-0000-0000-0000000000f1'), true, 'флаг сохранён');
select as_user('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select set_match_technical('00000000-0000-0000-0000-0000000000f1', false)$$, 'администратор без определимого клуба работает как раньше');
reset role;

-- delete_match: отказы
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select delete_match('00000000-0000-0000-0000-0000000000f1')$$, '42501', 'forbidden', 'тренер не удаляет матч');
reset role;
select as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select delete_match('00000000-0000-0000-0000-0000000000f1')$$, '42501', 'forbidden', 'администратор чужого клуба не удаляет матч');
reset role;
select is((select count(*)::int from matches where id = '00000000-0000-0000-0000-0000000000f1'), 1, 'после отказов матч на месте');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select delete_match('00000000-0000-0000-0000-0000000000ff')$$, 'P0001', 'match not found', 'нет матча: прежняя ошибка');
reset role;

-- delete_match: подмена pg_temp.matches
discard plans;
select as_user('00000000-0000-0000-0000-0000000000a2');
create temp table matches (like public.matches including defaults);
insert into pg_temp.matches (id, club_id, played_on, team) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c002', '2026-11-01', 'U9');
select throws_ok($$select delete_match('00000000-0000-0000-0000-0000000000f1')$$, '42501', 'forbidden', 'delete_match: подмена pg_temp.matches не обходит клуб');
drop table pg_temp.matches;
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1'), 1, 'после попытки с pg_temp.matches состав цел');
select is((select count(*)::int from matches where id = '00000000-0000-0000-0000-0000000000f1'), 1, 'матч на месте после попытки с pg_temp.matches');

-- delete_match: свои
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select delete_match('00000000-0000-0000-0000-0000000000f1')$$, 'администратор своего клуба удаляет матч');
reset role;
select is((select count(*)::int from matches where id = '00000000-0000-0000-0000-0000000000f1'), 0, 'матч удалён');
select as_user('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select delete_match('00000000-0000-0000-0000-0000000000f2')$$, 'администратор без определимого клуба работает как раньше');
reset role;
select as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select delete_match('00000000-0000-0000-0000-0000000000f3')$$, 'администратор клуба Б удаляет матч своего клуба');
reset role;

select * from finish();
rollback;
