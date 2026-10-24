-- pgTAP: тренеры видят и ведут все группы (0042), но не деньги, не чужие баллы и не контакты родителей чужих групп.
begin;
create extension if not exists pgtap;
select plan(14);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8002, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000c2', 8003, 'Тренер U11', false),
  ('00000000-0000-0000-0000-0000000000b1', 8004, 'Родитель U9', false),
  ('00000000-0000-0000-0000-0000000000b2', 8005, 'Не тренер', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок U9');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
  values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());
insert into rules (club_id, code, points, explanation, active_from) values
  ('00000000-0000-0000-0000-00000000c001', 'attendance_present', 1, 'Пришёл на тренировку', '2026-01-01');
insert into matches (id, club_id, played_on, team, opponent, goals_for, goals_against) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U9', 'Динамо', 3, 1);
insert into match_players (match_id, player_id, played, goals) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', true, 2);
insert into match_fees (match_id, player_id, amount) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000d001', 10);
insert into weekly_schedule (group_id, weekday, starts_at, kind) values
  ('00000000-0000-0000-0000-0000000000e1', 1, '17:00', 'Групповая');
insert into training_log (club_id, external_id, held_on, coach, group_label, kind, starts_at, ends_at, hours, held) values
  ('00000000-0000-0000-0000-00000000c001', 'k1', '2026-10-12', 'Дима', 'U9', 'Групповая', '17:00', '18:30', 1.5, true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Тренер U11 (чужой для группы U9) видит игроков, матчи, составы и голы U9
select as_user('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from players), 1, 'тренер видит игроков другой группы');
select is((select count(*)::int from matches where team = 'U9'), 1, 'тренер видит матч другой команды');
select is((select goals from match_players limit 1), 2, 'тренер видит голы в составе');
select is((select count(*)::int from groups), 2, 'тренер видит все группы');

-- ...и отмечает посещаемость группы U9, баллы за посещаемость начисляются
select lives_ok($$select open_session('00000000-0000-0000-0000-0000000000e1', '2026-10-12')$$, 'тренер открывает занятие другой группы');
select lives_ok($$select mark_attendance((select id from sessions limit 1), '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"}]'::jsonb)$$, 'тренер отмечает посещаемость другой группы');

-- Но не деньги, не чужие баллы и не контакты родителей
select is((select count(*)::int from match_fees), 0, 'взнос за матч тренеру не виден');
select is((select count(*)::int from payments), 0, 'платежи тренеру не видны');
select throws_ok($$select award_bonus('00000000-0000-0000-0000-00000000d001', 2, 'Молодец')$$, '42501', 'forbidden', 'ручные баллы чужой группы тренер не начисляет');
select throws_ok($$select * from group_parents('00000000-0000-0000-0000-0000000000e1')$$, '42501', 'forbidden', 'контакты родителей чужой группы тренеру недоступны');

-- Журнал тренировок: просмотр без часов
select is((select count(*)::int from trainer_attendance('2026-10-01', '2026-10-31')), 1, 'тренер видит, какие тренеры проводили занятия');
select ok(pg_get_function_result('trainer_attendance(date, date)'::regprocedure) not like '%hours%', 'в ответе журнала нет часов');

-- Не тренер и родитель: ничего из этого
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select * from trainer_attendance('2026-10-01', '2026-10-31')$$, '42501', 'forbidden', 'родитель журнал тренеров не видит');
select throws_ok($$select open_session('00000000-0000-0000-0000-0000000000e1', '2026-10-12')$$, '42501', 'forbidden', 'не тренер занятие не открывает');

select * from finish();
rollback;
