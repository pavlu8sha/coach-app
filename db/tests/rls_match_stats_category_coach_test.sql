-- pgTAP: фильтр по виду матчей работает и у тренера, хотя таблица tournaments ему закрыта (0082).
begin;
create extension if not exists pgtap;
select plan(8);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8401, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8402, 'Тренер U10', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U10-A');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into tournaments (id, club_id, team, kind, name, fee) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000c001', 'U10', 'championship', 'Чемпионат 1', 200),
  ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-00000000c001', 'U10', 'cup', 'Кубок', 50);
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against, kind, tournament_id) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U10', 'А', 3, 1, 'game', '00000000-0000-0000-0000-0000000007a1'),
  ('00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-00000000c001', '2026-10-11', 'U10', 'Б', 1, 1, 'friendly', null),
  ('00000000-0000-0000-0000-0000000008a3', '00000000-0000-0000-0000-00000000c001', '2026-10-12', 'U10', 'В', 2, 0, 'game', '00000000-0000-0000-0000-0000000007a2'),
  ('00000000-0000-0000-0000-0000000008a4', '00000000-0000-0000-0000-00000000c001', '2026-10-13', 'U10', 'Г', 0, 1, null, null);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from tournaments), 0, 'тренеру таблица tournaments закрыта (как и было)');
select is((select games from match_stats('2026-10-01', '2026-10-31') where kind = 'team'), 4, 'без фильтра: все четыре игры');
select is((select games from match_stats('2026-10-01', '2026-10-31', 'championship') where kind = 'team'), 1, 'тренер: чемпионат — одна игра');
select is((select games from match_stats('2026-10-01', '2026-10-31', 'cup') where kind = 'team'), 1, 'тренер: кубок — одна игра');
select is((select games from match_stats('2026-10-01', '2026-10-31', 'friendly') where kind = 'team'), 2, 'тренер: товарищеские — две (в том числе без вида и турнира)');
select is((select count(*)::int from match_stats('2026-10-01', '2026-10-31', 'festival') where kind = 'team'), 0, 'тренер: фестиваль — пусто');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select games from match_stats('2026-10-01', '2026-10-31', 'championship') where kind = 'team'), 1, 'администратор: чемпионат — одна игра');
select is((select games from match_stats('2026-10-01', '2026-10-31', 'friendly') where kind = 'team'), 2, 'администратор: товарищеские — две');

select * from finish();
rollback;
