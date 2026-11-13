-- pgTAP: матч именно группы (U13-B), а не всей команды U13 — set_match_team_group (0193). Условия: docs/MATCH_GROUP_TEAM_ACCEPTANCE.md. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(23);

-- права на базе с привилегиями по умолчанию Supabase
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0193_match_group_team.sql

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб'), ('00000000-0000-0000-0000-00000000c002', 'Другой клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7701, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7702, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 7703, 'Родитель B', false),
  ('00000000-0000-0000-0000-0000000000b2', 7704, 'Родитель A', false),
  ('00000000-0000-0000-0000-0000000000b3', 7705, 'Посторонний', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U13-A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U13-B'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'U12'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000c002', 'U13-B');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Игрок B'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок A');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'test', now());
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-11-14', 'U13', 'Ortachala U12', null, null),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', '2026-11-01', 'U13', 'Старый', 3, 1);
insert into match_players (match_id, player_id, played, goals, best) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000d001', true, 1, false);
insert into tournaments (id, club_id, kind, team, name, fee) values ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000c001', 'cup', 'U13', 'Кубок', 0);
insert into matches (id, club_id, played_on, team, opponent, tournament_id) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000c001', '2026-11-02', 'U13', 'Кубковый', '00000000-0000-0000-0000-0000000000a9');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 8. права
select ok(has_function_privilege('authenticated', 'set_match_team_group(uuid,uuid,boolean)', 'execute'), 'authenticated вызывает функцию');
select ok(not has_function_privilege('anon', 'set_match_team_group(uuid,uuid,boolean)', 'execute'), 'anon не вызывает функцию (при умолчаниях Supabase)');
select ok(not has_function_privilege('public', 'set_match_team_group(uuid,uuid,boolean)', 'execute'), 'public не вызывает функцию');

-- 1. доступ
select throws_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e2', true)$$, '42501', 'not authenticated', 'без входа нельзя');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e2', true)$$, '42501', 'forbidden', 'родитель не меняет команду матча');
select as_user('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e2', true)$$, '42501', 'forbidden', 'посторонний не меняет команду матча');
reset role;
select is((select team from matches where id = '00000000-0000-0000-0000-0000000000f1'), 'U13', 'после отказов команда не изменилась');

-- 2. тренер выбирает группу U13-B
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e2', true)$$, 'тренер делает матч матчем U13-B');
reset role;
select is((select team from matches where id = '00000000-0000-0000-0000-0000000000f1'), 'U13-B', 'команда матча — U13-B');
-- повтор безопасен (матч U13-B, группа U13-B)
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e2', true)$$, 'повторный вызов безопасен');
-- 3. не та группа
select throws_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', true)$$, 'P0001', 'group not in match team', 'U13-A не подходит матчу U13-B');
select throws_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e3', true)$$, 'P0001', 'group not in match team', 'U12 не подходит матчу U13-B');
select throws_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e4', true)$$, 'P0001', 'group not in match team', 'группа другого клуба не подходит');
-- возврат к команде
select lives_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e2', false)$$, 'возврат к команде U13');
reset role;
select is((select team from matches where id = '00000000-0000-0000-0000-0000000000f1'), 'U13', 'команда снова U13');

-- 4. ошибки
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-0000000000e2', true)$$, 'P0001', 'match not found', 'нет матча');
select throws_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000ee', true)$$, 'P0001', 'group not found', 'нет группы');
-- 5. турнир
select throws_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e2', true)$$, 'P0001', 'tournament match', 'матч турнира не меняется');

-- 6. остальное не тронуто
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select set_match_team_group('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2', true)$$, 'старый матч со счётом переводится в U13-B');
reset role;
select is((select (goals_for, goals_against, opponent, played_on)::text from matches where id = '00000000-0000-0000-0000-0000000000f2'), '(3,1,Старый,2026-11-01)', 'счёт, соперник и дата не изменились');
select is((select count(*)::int from match_players where match_id = '00000000-0000-0000-0000-0000000000f2'), 1, 'состав не изменился');

-- 7. видимость
select as_user('00000000-0000-0000-0000-0000000000b1');
select ok(can_see_team('00000000-0000-0000-0000-00000000c001', 'U13-B'), 'родитель игрока U13-B видит команду матча U13-B');
select as_user('00000000-0000-0000-0000-0000000000b2');
select ok(not can_see_team('00000000-0000-0000-0000-00000000c001', 'U13-B'), 'родитель игрока U13-A не видит матч U13-B');

select * from finish();
rollback;
