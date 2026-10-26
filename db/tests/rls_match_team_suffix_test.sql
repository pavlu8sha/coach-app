-- pgTAP: команда матча без суффикса группы (U10 = U10-A + U10-B), Issue #172; чужие команды остаются закрытыми.
begin;
create extension if not exists pgtap;
select plan(12);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000b1', 9101, 'Родитель U10-A', false),
  ('00000000-0000-0000-0000-0000000000b2', 9102, 'Родитель U9-A', false),
  ('00000000-0000-0000-0000-0000000000b3', 9103, 'Родитель U9-B', false),
  ('00000000-0000-0000-0000-0000000000b4', 9104, 'Родитель Ortachala U9', false),
  ('00000000-0000-0000-0000-0000000000c1', 9105, 'Тренер U10-B', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U10-A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U10-B'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'U9-A'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000c001', 'U9-B'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000c001', 'Ortachala U9'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-00000000c001', 'U13-A');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок U10-A'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e3', 'Игрок U9-A'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e4', 'Игрок U9-B'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e5', 'Игрок Ortachala U9');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b3', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b4', 'test', now());
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2');
insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U10', 'Соперник U10'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', '2026-10-11', 'U13-A', 'Соперник U13'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000c001', '2026-10-12', 'U9', 'Соперник U9');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from matches where team = 'U10'), 1, 'родитель ребёнка U10-A видит матч команды U10');
select is((select count(*)::int from matches where team = 'U13-A'), 0, 'родитель U10-A не видит матч U13-A');
select is((select count(*)::int from matches where team = 'U9'), 0, 'родитель U10-A не видит матч U9');

select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from matches where team = 'U9'), 1, 'родитель ребёнка U9-A видит матч команды U9');
select is((select count(*)::int from matches where team = 'U10'), 0, 'родитель U9-A не видит матч U10');

select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from matches where team = 'U9'), 1, 'родитель ребёнка U9-B видит матч команды U9');

select as_user('00000000-0000-0000-0000-0000000000b4');
select is((select count(*)::int from matches where team = 'U9'), 0, 'родитель ребёнка Ortachala U9 не видит матч U9 (не склеивается с U9-A/U9-B)');
select is((select count(*)::int from matches), 0, 'родитель Ortachala U9 не видит никаких матчей');

select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from matches where team = 'U10'), 1, 'тренер U10-B видит матч команды U10');

select as_user('00000000-0000-0000-0000-0000000000b4');
select is(can_see_team('00000000-0000-0000-0000-00000000c001', 'U10'), false, 'can_see_team: родитель Ortachala U9 команду U10 не видит');
reset role;
select is((select count(*)::int from groups where name ~ '-[ABC]$' and left(name, length(name) - 2) = 'Ortachala U9'), 0, 'у Ortachala U9 нет групп с суффиксом');
select is((select count(*)::int from groups where name ~ '-[ABC]$' and left(name, length(name) - 2) = 'U9'), 2, 'команде U9 соответствуют ровно U9-A и U9-B');

select * from finish();
rollback;
