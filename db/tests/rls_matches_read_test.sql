-- pgTAP: чтение матчей и расписания только своей группой.
begin;
create extension if not exists pgtap;
select plan(16);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9002, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000b1', 9003, 'Родитель U9', false),
  ('00000000-0000-0000-0000-0000000000b2', 9004, 'Родитель U11', false),
  ('00000000-0000-0000-0000-0000000000b3', 9005, 'Без детей', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок U9'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Игрок U11'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Другой игрок U9');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'test', now());
insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U9', 'Соперник 1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', '2026-10-11', 'U11', 'Соперник 2'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000c001', '2026-10-12', 'U9', 'Соперник 3');
-- в матче U9 играл мальчик из U11 (гость)
insert into match_players (match_id, player_id, played, goals) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000d002', true, 1),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000d001', true, 2),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000d003', true, 0);
insert into weekly_schedule (group_id, weekday, starts_at, kind) values
  ('00000000-0000-0000-0000-0000000000e1', 1, '18:00', 'Групповая'),
  ('00000000-0000-0000-0000-0000000000e2', 2, '17:00', 'Групповая');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from matches), 2, 'родитель U9 видит два матча своей команды');
select is((select count(*)::int from matches where team = 'U11'), 0, 'родитель U9 не видит матчи U11');
select is((select count(*)::int from match_players), 1, 'родитель видит записи только своего ребёнка (без чужих голов)');
select is((select count(*)::int from weekly_schedule), 1, 'родитель U9 видит расписание только своей группы');

select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from matches), 2, 'родитель U11: матч своей группы и матч U9, в котором играл его ребёнок');
select is((select count(*)::int from matches where team = 'U9' and opponent = 'Соперник 1'), 0, 'родитель U11 не видит чужой матч U9 без участия ребёнка');
select is((select count(*)::int from weekly_schedule), 1, 'родитель U11 видит расписание только U11');

select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from matches), 2, 'тренер U9 видит матчи U9');
select is((select count(*)::int from matches where team = 'U11'), 0, 'тренер U9 не видит матчи U11');
select is((select count(*)::int from weekly_schedule), 1, 'тренер U9 видит расписание U9');

select as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from matches), 0, 'пользователь без детей матчей не видит');
select is((select count(*)::int from weekly_schedule), 0, 'пользователь без детей расписания не видит');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from matches), 3, 'администратор видит все матчи');
select is((select count(*)::int from weekly_schedule), 2, 'администратор видит всё расписание');

select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$insert into matches (club_id, played_on, team) values ('00000000-0000-0000-0000-00000000c001', '2026-10-20', 'U9')$$, '42501', null, 'родитель не пишет матчи');
select throws_ok($$insert into weekly_schedule (group_id, weekday, starts_at) values ('00000000-0000-0000-0000-0000000000e1', 3, '10:00')$$, '42501', null, 'родитель не пишет расписание');

select * from finish();
rollback;
