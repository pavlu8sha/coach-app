-- pgTAP: remove_match_player закрывает чужой клуб (0225). Условия: docs/REMOVE_MATCH_PLAYER_CLUB_ACCEPTANCE.md. Фикстуры вымышленные.
-- Выполняется на базе с применёнными миграциями (включая 0225). Права проверяются при умолчаниях Supabase.
begin;
create extension if not exists pgtap;
select plan(21);

alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- пересоздаём функцию под умолчаниями Supabase (тело берётся из миграции 0225)
drop function remove_match_player(uuid, uuid);
\i db/migrations/0225_remove_match_player_club.sql

insert into clubs (id, name) values
  ('00000000-0000-0000-0000-00000000c001', 'Клуб А'),
  ('00000000-0000-0000-0000-00000000c002', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000a1', 7701, 'Админ А', true,  '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000a2', 7702, 'Админ Б', true,  '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000a3', 7706, 'Админ без клуба', true, null),
  ('00000000-0000-0000-0000-0000000000c1', 7703, 'Тренер А', false, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000c2', 7704, 'Тренер Б', false, '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-0000000000c3', 7707, 'Тренер без клуба', false, null),
  ('00000000-0000-0000-0000-0000000000b1', 7705, 'Родитель', false, '00000000-0000-0000-0000-00000000c001');
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c002', 'U9');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 2'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 3');
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-11-01', 'U9', 'Соперник', 3, 1);
insert into match_players (match_id, player_id, played, goals, best, performance_rating) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', true, 2, true, 5),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002', true, 1, false, 3),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d003', true, 0, false, 4);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 7. права
select ok(has_function_privilege('authenticated', 'remove_match_player(uuid,uuid)', 'execute'), 'authenticated вызывает функцию');
select ok(not has_function_privilege('anon', 'remove_match_player(uuid,uuid)', 'execute'), 'anon не вызывает функцию (при умолчаниях Supabase)');

-- 2. тренер чужого клуба отклонён, ничего не изменилось
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'тренер чужого клуба не может убрать игрока');
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1'), 3, 'после отказа чужому тренеру состав цел');
select is((select performance_rating::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1' and player_id = '00000000-0000-0000-0000-00000000d001'), 5, 'оценка не стёрта');

-- 4. администратор другого клуба отклонён
select as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'администратор чужого клуба не может убрать игрока');
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1'), 3, 'после отказа чужому администратору состав цел');

-- 3. тренер без клуба при двух клубах: запрет по умолчанию
select as_user('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'тренер с неопределимым клубом получает отказ');
reset role;

-- 5. родитель
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'родитель не может убрать игрока');
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1'), 3, 'после отказов состав цел');

-- 8. прямой delete тренеру недоступен
select as_user('00000000-0000-0000-0000-0000000000c1');
delete from match_players where player_id = '00000000-0000-0000-0000-00000000d002';
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1'), 3, 'прямой delete тренера ничего не удаляет');

-- 6. ошибки для своего клуба
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-00000000d001')$$, 'P0001', 'match not found', 'нет матча');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d009')$$, 'P0001', 'player not in match', 'игрока нет в составе');
reset role;

-- 1. тренер своего клуба убирает лучшего игрока
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001')$$, 'тренер своего клуба убирает игрока');
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1' and player_id = '00000000-0000-0000-0000-00000000d001'), 0, 'строка игрока удалена');
select is((select goals from match_players where match_id = '00000000-0000-0000-0000-0000000000f1' and player_id = '00000000-0000-0000-0000-00000000d002'), 1, 'другой игрок не тронут');
select is((select goals_for from matches where id = '00000000-0000-0000-0000-0000000000f1'), 3, 'счёт матча не изменился');

-- 4. администратор своего клуба
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002')$$, 'администратор своего клуба убирает игрока');
reset role;

-- 4. администратор без определимого клуба работает как раньше
select as_user('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d003')$$, 'администратор без клуба работает как раньше');
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1'), 0, 'состав пуст после трёх удалений');

-- 5. без входа
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', '{}', true);
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002')$$, '42501', 'not authenticated', 'без входа отказ');

select * from finish();
rollback;
