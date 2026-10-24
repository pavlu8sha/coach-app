-- pgTAP: статистика посещаемости по группам (0033).
begin;
create extension if not exists pgtap;
select plan(14);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8201, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8202, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000b1', 8203, 'Родитель', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Вика', 'active');
insert into sessions (id, group_id, starts_at) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000000e1', '2026-10-05 15:00+04'),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-0000000000e1', '2026-10-07 15:00+04'),
  ('00000000-0000-0000-0000-0000000005e3', '00000000-0000-0000-0000-0000000000e1', '2026-10-09 15:00+04'),
  ('00000000-0000-0000-0000-0000000005e4', '00000000-0000-0000-0000-0000000000e2', '2026-10-06 15:00+04');
insert into attendance (session_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000d002', 'absent'),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-00000000d002', 'present'),
  -- занятие e3: никто не пришёл — не считается проведённым
  ('00000000-0000-0000-0000-0000000005e3', '00000000-0000-0000-0000-00000000d001', 'absent'),
  ('00000000-0000-0000-0000-0000000005e4', '00000000-0000-0000-0000-00000000d003', 'present');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select total from attendance_stats('2026-10-01', '2026-10-31') where full_name = 'Аня'), 2, 'проведённых занятий два (без занятия, где никого не было)');
select is((select attended from attendance_stats('2026-10-01', '2026-10-31') where full_name = 'Аня'), 2, 'Аня была на обоих');
select is((select attended from attendance_stats('2026-10-01', '2026-10-31') where full_name = 'Боря'), 1, 'Боря был на одном из двух');
select is((select count(distinct group_name)::int from attendance_stats('2026-10-01', '2026-10-31')), 2, 'администратор видит обе группы');
select is((select count(*)::int from attendance_stats('2026-10-06', '2026-10-06')), 1, 'период сужает выборку (только U11 6 октября)');

select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(distinct group_name)::int from attendance_stats('2026-10-01', '2026-10-31')), 2, 'тренер видит статистику посещаемости всех групп');

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from attendance_stats('2026-10-01', '2026-10-31')$$, '42501', 'forbidden', 'родителю статистика недоступна');

select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select * from attendance_stats('2026-10-31', '2026-10-01')$$, '22023', 'bad period', 'перевёрнутый период отклоняется');
select throws_ok($$select * from attendance_stats('2025-01-01', '2026-10-01')$$, '22023', 'period too large', 'слишком большой период отклоняется');

-- Матчи
reset role;
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U9', 'А', 3, 1),
  ('00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-00000000c001', '2026-10-12', 'U9', 'Б', 1, 1),
  ('00000000-0000-0000-0000-0000000008a3', '00000000-0000-0000-0000-00000000c001', '2026-10-14', 'U11', 'В', 0, 2),
  ('00000000-0000-0000-0000-0000000008a4', '00000000-0000-0000-0000-00000000c001', '2026-10-15', 'U9', 'Г', null, null);
insert into match_players (match_id, player_id, played, goals) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d001', true, 2),
  ('00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-00000000d001', true, 0),
  ('00000000-0000-0000-0000-0000000008a3', '00000000-0000-0000-0000-00000000d003', true, 0);
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select games from match_stats('2026-10-01', '2026-10-31') where kind = 'team' and team = 'U9'), 2, 'матч без счёта не считается: у U9 два матча');
select is((select array[wins, draws, losses, goals_for, goals_against] from match_stats('2026-10-01', '2026-10-31') where kind = 'team' and team = 'U9'), array[1, 1, 0, 4, 2], 'победа, ничья, голы 4:2');
select is((select array[played, goals] from match_stats('2026-10-01', '2026-10-31') where kind = 'player' and name = 'Аня'), array[2, 2], 'игрок: два матча, два гола');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from match_stats('2026-10-01', '2026-10-31')$$, '42501', 'forbidden', 'родителю статистика матчей недоступна');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from match_stats('2026-10-01', '2026-10-31') where kind = 'team' and team = 'U11'), 1, 'тренер U9 видит статистику матчей U11');

select * from finish();
rollback;
