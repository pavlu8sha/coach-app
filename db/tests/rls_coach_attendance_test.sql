-- pgTAP: отметка посещаемости тренером и автобаллы.
begin;
create extension if not exists pgtap;
select plan(22);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 5001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 5002, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000c2', 5003, 'Тренер U11', false),
  ('00000000-0000-0000-0000-0000000000b1', 5004, 'Родитель', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 1'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 2'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок 3'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Чужой игрок');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
  values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());
-- расписание U9: понедельник 18:00 (2026-10-19 — понедельник)
insert into weekly_schedule (group_id, weekday, starts_at, ends_at, kind)
  values ('00000000-0000-0000-0000-0000000000e1', 1, '18:00', '19:30', 'Групповая');
insert into rules (club_id, code, points, explanation, active_from)
  values ('00000000-0000-0000-0000-00000000c001', 'attendance_present', 1, 'Пришёл на тренировку', '2026-01-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Открытие занятия
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select open_session('00000000-0000-0000-0000-0000000000e1', '2026-10-19')$$, '42501', 'forbidden', 'тренер чужой группы не открывает занятие');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select open_session('00000000-0000-0000-0000-0000000000e1', '2026-10-19')$$, '42501', 'forbidden', 'родитель не открывает занятие');

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select open_session('00000000-0000-0000-0000-0000000000e1', '2026-10-20')$$, null, 'no training scheduled', 'в день без занятия по расписанию открыть нельзя');
select throws_ok($$select open_session('00000000-0000-0000-0000-0000000000e1', (current_date + 30))$$, null, 'date in the future', 'будущую дату открыть нельзя');
select lives_ok($$select open_session('00000000-0000-0000-0000-0000000000e1', '2026-10-19')$$, 'тренер открывает занятие по расписанию');
select is((select count(*)::int from sessions where source_key = 'ATT|2026-10-19'), 1, 'занятие создано с ключом ATT|дата');
select is((select open_session('00000000-0000-0000-0000-0000000000e1', '2026-10-19')), (select id from sessions where source_key = 'ATT|2026-10-19'), 'повторное открытие возвращает то же занятие');
select is((select tbilisi_day(starts_at) from sessions where source_key = 'ATT|2026-10-19'), '2026-10-19'::date, 'начало занятия по времени Тбилиси');

-- Прямая запись тренера закрыта
select throws_ok($$insert into sessions (group_id, starts_at, kind) values ('00000000-0000-0000-0000-0000000000e1', now(), 'training')$$, '42501', null, 'тренер не создаёт занятия напрямую');
select throws_ok($$insert into attendance (session_id, player_id, status) select id, '00000000-0000-0000-0000-00000000d001', 'present' from sessions limit 1$$, '42501', null, 'тренер не пишет посещаемость напрямую');

-- Отметки и баллы
select lives_ok($$select mark_attendance((select id from sessions where source_key = 'ATT|2026-10-19'),
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},
    {"player_id":"00000000-0000-0000-0000-00000000d002","status":"present"},
    {"player_id":"00000000-0000-0000-0000-00000000d003","status":"excused"}]'::jsonb)$$, 'тренер отмечает посещаемость');
select is((select count(*)::int from attendance), 3, 'три отметки записаны');
select is((select count(*)::int from point_events where source_type = 'session'), 2, 'баллы только тем, кто пришёл');
select is((select occurred_on from point_events limit 1), '2026-10-19'::date, 'дата начисления — день занятия');
select is((select count(distinct marked_by)::int from attendance where marked_by = '00000000-0000-0000-0000-0000000000c1'), 1, 'в отметке записан тренер');

-- Исправление задним числом: Игрок 1 на самом деле не был, Игрок 3 был
select mark_attendance((select id from sessions where source_key = 'ATT|2026-10-19'),
  '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"absent"},
    {"player_id":"00000000-0000-0000-0000-00000000d003","status":"present"}]'::jsonb);
select is((select count(*)::int from point_events), 2, 'после правки баллов по-прежнему два начисления, без дублей');
select is((select string_agg(player_id::text, ',' order by player_id::text) from point_events), '00000000-0000-0000-0000-00000000d002,00000000-0000-0000-0000-00000000d003', 'баллы у тех, кто пришёл после правки');

-- Ограничения функции
select throws_ok($$select mark_attendance((select id from sessions limit 1), '[{"player_id":"00000000-0000-0000-0000-00000000d009","status":"present"}]'::jsonb)$$, null, 'player not in group', 'игрока чужой группы отметить нельзя');
select throws_ok($$select mark_attendance((select id from sessions limit 1), '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"late"}]'::jsonb)$$, null, 'invalid status', 'неизвестный статус отклоняется');

select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select mark_attendance((select id from sessions limit 1), '[]'::jsonb)$$, null, null, 'тренер чужой группы не отмечает посещаемость');

-- Родитель видит баллы своего ребёнка
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from attendance), 1, 'родитель видит посещаемость только своего ребёнка');
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$insert into attendance (session_id, player_id, status) select id, '00000000-0000-0000-0000-00000000d009', 'present' from sessions limit 1$$, 'администратор по-прежнему пишет напрямую');

select * from finish();
rollback;
