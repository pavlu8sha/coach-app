-- pgTAP: тренер убирает игрока из матча через remove_match_player (0192). Условия: docs/COACH_REMOVE_MATCH_PLAYER_ACCEPTANCE.md. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(18);

-- права на базе с привилегиями по умолчанию Supabase: пересоздаём функцию под ними
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
drop function remove_match_player(uuid, uuid);
\i db/migrations/0192_coach_remove_match_player.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7601, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7602, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 7603, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 2'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 3');
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-11-01', 'U9', 'Соперник', 3, 1);
insert into match_players (match_id, player_id, played, goals, best) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', true, 2, true),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002', true, 1, false);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 6. права
select ok(has_function_privilege('authenticated', 'remove_match_player(uuid,uuid)', 'execute'), 'authenticated вызывает функцию');
select ok(not has_function_privilege('anon', 'remove_match_player(uuid,uuid)', 'execute'), 'anon не вызывает функцию (при умолчаниях Supabase)');

-- 1. родитель отклонён, состав не изменился
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001')$$, '42501', 'forbidden', 'родитель не может убрать игрока');
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1'), 2, 'после отказа состав цел');

-- 7. прямой delete тренеру недоступен (политики не менялись)
select as_user('00000000-0000-0000-0000-0000000000c1');
delete from match_players where player_id = '00000000-0000-0000-0000-00000000d002';
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1'), 2, 'прямой delete тренера ничего не удаляет');

-- 4. ошибки
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-00000000d001')$$, 'P0001', 'match not found', 'нет матча');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d003')$$, 'P0001', 'player not in match', 'игрок не в составе матча');
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1'), 2, 'после ошибок состав цел');

-- 1-3. тренер убирает лучшего игрока
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001')$$, 'тренер убирает игрока');
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1' and player_id = '00000000-0000-0000-0000-00000000d001'), 0, 'строка игрока удалена');
select is((select played from match_players where match_id = '00000000-0000-0000-0000-0000000000f1' and player_id = '00000000-0000-0000-0000-00000000d002'), true, 'другой игрок не тронут: играл');
select is((select goals from match_players where match_id = '00000000-0000-0000-0000-0000000000f1' and player_id = '00000000-0000-0000-0000-00000000d002'), 1, 'другой игрок не тронут: голы');
select is((select goals_for from matches where id = '00000000-0000-0000-0000-0000000000f1'), 3, 'счёт матча не изменился');
select is((select count(*)::int from matches where id = '00000000-0000-0000-0000-0000000000f1'), 1, 'матч на месте');

-- администратор тоже
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002')$$, 'администратор убирает игрока');
reset role;
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f1'), 0, 'состав пуст после двух удалений');

-- повторный вызов: игрока уже нет
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002')$$, 'P0001', 'player not in match', 'повторное удаление отклоняется');
reset role;

-- без входа
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', '{}', true);
select throws_ok($$select remove_match_player('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d002')$$, '42501', 'not authenticated', 'без входа отказ');

select * from finish();
rollback;
