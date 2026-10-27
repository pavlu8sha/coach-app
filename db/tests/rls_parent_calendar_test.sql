-- pgTAP: календарь родителя показывает события своего ребёнка и не обходит согласие/RLS.
begin;
create extension if not exists pgtap;
select plan(8);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9300, 'Администратор', true),
  ('00000000-0000-0000-0000-0000000000b1', 9301, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 9302, 'Родитель Б', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-A', 'Поле U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11', 'Поле U11');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок А'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Игрок Б');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'test', now());

insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', (now() at time zone 'Asia/Tbilisi')::date, 'U9', 'Матч А', 2, 1),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c001', (now() at time zone 'Asia/Tbilisi')::date, 'U11', 'Чужой матч', 0, 4);
insert into match_players (match_id, player_id, played, goals) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', true, 1),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000d002', true, 0);
insert into sessions (id, group_id, starts_at, kind) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1',
   (((now() at time zone 'Asia/Tbilisi')::date - 1 + time '18:00') at time zone 'Asia/Tbilisi'), 'training'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2',
   (((now() at time zone 'Asia/Tbilisi')::date - 1 + time '18:00') at time zone 'Asia/Tbilisi'), 'training');
insert into attendance (session_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', 'present');
insert into training_log (club_id, external_id, held_on, weekday, coach, location, group_label, kind, starts_at, ends_at, hours, held)
values ('00000000-0000-0000-0000-00000000c001', 'CAL-TRAINING-1',
  (now() at time zone 'Asia/Tbilisi')::date - 2, 'Mon', 'Тренер U9', 'Поле U9', 'U9-A', 'Групповая', '18:00', '19:00', 1, true);
insert into weekly_schedule (group_id, weekday, starts_at, kind, location) values
  ('00000000-0000-0000-0000-0000000000e1',
   extract(isodow from ((now() at time zone 'Asia/Tbilisi')::date + 1))::int,
   '19:00', 'Групповая', 'Поле U9'),
  ('00000000-0000-0000-0000-0000000000e2',
   extract(isodow from ((now() at time zone 'Asia/Tbilisi')::date + 1))::int,
   '19:00', 'Групповая', 'Поле U11');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parent_calendar(
  '00000000-0000-0000-0000-00000000d001',
  (now() at time zone 'Asia/Tbilisi')::date - 2,
  (now() at time zone 'Asia/Tbilisi')::date + 1
)), 4, 'календарь содержит матч, архивную и фактическую тренировки и будущую запись расписания');
select is((select count(*)::int from parent_calendar(
  '00000000-0000-0000-0000-00000000d001',
  (now() at time zone 'Asia/Tbilisi')::date - 2,
  (now() at time zone 'Asia/Tbilisi')::date - 2
) where title = 'Тренировка'), 1, 'архив тренировки отображается отдельным событием');

select is((select attendance_status from parent_calendar(
  '00000000-0000-0000-0000-00000000d001',
  (now() at time zone 'Asia/Tbilisi')::date - 1,
  (now() at time zone 'Asia/Tbilisi')::date - 1
) where event_type = 'training'), 'present', 'возвращается посещаемость только своего ребёнка');
select throws_ok($$select count(*) from parent_calendar('00000000-0000-0000-0000-00000000d002', current_date, current_date)$$,
  '42501', 'forbidden', 'родитель не читает календарь чужого ребёнка');
select as_user('00000000-0000-0000-0000-0000000000a1');
update player_guardians set consent_revoked_at = now()
where player_id = '00000000-0000-0000-0000-00000000d001'
  and user_id = '00000000-0000-0000-0000-0000000000b1';
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select count(*) from parent_calendar('00000000-0000-0000-0000-00000000d001', current_date, current_date)$$,
  '42501', 'forbidden', 'после отзыва согласия календарь недоступен');
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select count(*) from parent_calendar('00000000-0000-0000-0000-00000000d002', current_date, current_date)$$,
  '42501', 'not authenticated', 'без пользователя календарь недоступен');
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select count(*) from parent_calendar('00000000-0000-0000-0000-00000000d002', current_date, current_date - 181)$$,
  '22023', 'invalid date range', 'некорректный диапазон дат отклоняется');
select throws_ok($$select count(*) from parent_calendar('00000000-0000-0000-0000-00000000d002', current_date, current_date + 181)$$,
  '22023', 'date range too large', 'диапазон больше 180 дней отклоняется');

select * from finish();
rollback;
