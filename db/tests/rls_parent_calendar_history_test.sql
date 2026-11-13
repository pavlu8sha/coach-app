-- pgTAP: parent_calendar после смены группы (#628) и жизненный цикл матчей (#629), миграция 0194.
-- Условия: docs/PARENT_CALENDAR_HISTORY_ACCEPTANCE.md. Фикстуры вымышленные. Перевод ребёнка: T = сегодня - 5 дней.
begin;
create extension if not exists pgtap;
select plan(29);

-- права проверяются на базе с привилегиями по умолчанию Supabase
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\i db/migrations/0194_parent_calendar_history_lifecycle.sql

create function td(n int) returns date language sql as $$ select (now() at time zone 'Asia/Tbilisi')::date + n $$;
create function ts(n int, t time) returns timestamptz language sql as $$ select ((td(n) + t) at time zone 'Asia/Tbilisi') $$;

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9401, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9402, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 9403, 'Родитель Б', false),
  ('00000000-0000-0000-0000-0000000000b3', 9404, 'Родитель В', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9', 'Поле U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11', 'Поле U11'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'U13', 'Поле U13');
-- А: был в U9, переведён в U11. Б: другая семья, всегда в U9. В: другая семья, всегда в U13.
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок А'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Игрок Б'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e3', 'Игрок В');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b3', 'test', now());

-- перевод А из U9 в U11 «задним числом»: триггер ведёт историю с сегодняшнего дня, сдвигаем границу на T = сегодня - 5
update players set group_id = '00000000-0000-0000-0000-0000000000e2' where id = '00000000-0000-0000-0000-00000000d001';
update player_group_history set valid_to = td(-5)
  where player_id = '00000000-0000-0000-0000-00000000d001' and group_id = '00000000-0000-0000-0000-0000000000e1';
update player_group_history set valid_from = td(-5)
  where player_id = '00000000-0000-0000-0000-00000000d001' and valid_to is null;

insert into sessions (id, group_id, starts_at, kind) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', ts(-7, '18:00'), 'training'), -- T-2, U9, отметка А
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000e1', ts(-6, '18:00'), 'training'), -- T-1, U9, без отметки
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000000e1', ts(-5, '17:00'), 'training'), -- T, U9, без отметки
  ('00000000-0000-0000-0000-0000000005a4', '00000000-0000-0000-0000-0000000000e1', ts(-5, '19:00'), 'training'), -- T, U9, отметка А
  ('00000000-0000-0000-0000-0000000005a5', '00000000-0000-0000-0000-0000000000e2', ts(-8, '18:00'), 'training'), -- T-3, U11, до перевода
  ('00000000-0000-0000-0000-0000000005a6', '00000000-0000-0000-0000-0000000000e2', ts(-5, '18:00'), 'training'), -- T, U11, без отметки
  ('00000000-0000-0000-0000-0000000005a7', '00000000-0000-0000-0000-0000000000e2', ts(-4, '18:00'), 'training'), -- T+1, U11, отметка А
  ('00000000-0000-0000-0000-0000000005a8', '00000000-0000-0000-0000-0000000000e2', ts(-3, '18:00'), 'training'), -- T+2, U11, отметка только чужого ребёнка
  ('00000000-0000-0000-0000-0000000005a9', '00000000-0000-0000-0000-0000000000e3', ts(-6, '18:00'), 'training'); -- чужая группа U13
insert into attendance (session_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002', 'absent'),
  ('00000000-0000-0000-0000-0000000005a4', '00000000-0000-0000-0000-00000000d001', 'absent'),
  ('00000000-0000-0000-0000-0000000005a7', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a8', '00000000-0000-0000-0000-00000000d002', 'present'),
  ('00000000-0000-0000-0000-0000000005a9', '00000000-0000-0000-0000-00000000d003', 'present');
insert into training_log (club_id, external_id, held_on, weekday, coach, location, group_label, kind, starts_at, ends_at, hours, held) values
  ('00000000-0000-0000-0000-00000000c001', 'H-U9-OLD',  td(-9), 'Mon', 'Тренер', 'Поле U9',  'U9',  'Групповая', '18:00', '19:00', 1, true),  -- T-4, старая группа
  ('00000000-0000-0000-0000-00000000c001', 'H-U9-NEW',  td(-4), 'Mon', 'Тренер', 'Поле U9',  'U9',  'Групповая', '18:00', '19:00', 1, true),  -- T+1, уже новая группа
  ('00000000-0000-0000-0000-00000000c001', 'H-U11-OLD', td(-9), 'Mon', 'Тренер', 'Поле U11', 'U11', 'Групповая', '16:00', '17:00', 1, true),  -- T-4, группа U11 тогда не его
  ('00000000-0000-0000-0000-00000000c001', 'H-U11-NEW', td(-2), 'Mon', 'Тренер', 'Поле U11', 'U11', 'Групповая', '18:00', '19:00', 1, true);  -- T+3, новая группа
-- матчи команды U11 (текущая группа А)
insert into matches (id, club_id, played_on, team, opponent, lifecycle_status, starts_at) values
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-00000000c001', td(2), 'U11', 'Опубликованный', 'published', ts(2, '12:00')),
  ('00000000-0000-0000-0000-0000000005b2', '00000000-0000-0000-0000-00000000c001', td(3), 'U11', 'Черновик',       'draft',     ts(3, '12:00')),
  ('00000000-0000-0000-0000-0000000005b3', '00000000-0000-0000-0000-00000000c001', td(4), 'U11', 'Отменённый',     'cancelled', ts(4, '12:00'));
insert into matches (id, club_id, played_on, team, opponent) values
  ('00000000-0000-0000-0000-0000000005b4', '00000000-0000-0000-0000-00000000c001', td(5), 'U11', 'Старый без цикла');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select attendance_status from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a1'), 'present', '#628: посещённая тренировка старой группы остаётся в календаре с отметкой');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a2'), 1, '#628: занятие старой группы до перевода без отметки показывается (группа на дату)');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a3'), 0, '#628: день перевода относится к новой группе: занятие старой группы без отметки скрыто');
select is((select attendance_status from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a4'), 'absent', '#628: в день перевода занятие старой группы с отметкой показывается');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a5'), 0, '#628: занятие новой группы до перевода без отметки не показывается');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a6'), 1, '#628: в день перевода занятие новой группы показывается');
select is((select attendance_status from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a6'), null, '#628: у занятия новой группы нет ложной отметки');
select is((select attendance_status from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a7'), 'present', '#628: занятие новой группы после перевода с отметкой');
select is((select attendance_status from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a8'), null, '#628: отметка чужого ребёнка того же занятия не попадает');
select is((select attendance_status from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a1'), 'present', '#628: на общем занятии отметка именно этого ребёнка, не соседа');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a9'), 0, '#628: занятие чужой группы с отметкой другого ребёнка не попадает');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id like 'training-log:%' and event_date = td(-9) and location = 'Поле U9'), 1, '#628: журнал: запись старой группы за период до перевода показывается');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id like 'training-log:%' and event_date = td(-4)), 0, '#628: журнал: запись старой группы после перевода скрыта');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id like 'training-log:%' and event_date = td(-2)), 1, '#628: журнал: запись новой группы после перевода показывается');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id like 'training-log:%' and event_date = td(-9) and location = 'Поле U11'), 0, '#628: журнал: запись группы, в которой ребёнка тогда не было, скрыта');
select is((select event_status from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'match:00000000-0000-0000-0000-0000000005b1'), 'upcoming', '#629: опубликованный будущий матч показывается как предстоящий');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'match:00000000-0000-0000-0000-0000000005b2'), 0, '#629: черновик родителю не виден');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'match:00000000-0000-0000-0000-0000000005b3'), 0, '#629: отменённый матч не возвращается');
select is((select event_status from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_id = 'match:00000000-0000-0000-0000-0000000005b4'), 'upcoming', '#629: старый матч без жизненного цикла (legacy) показывается как раньше');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6)) where event_type = 'match'), 2, '#629: из четырёх матчей возвращаются только published и legacy');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select attendance_status from parent_calendar('00000000-0000-0000-0000-00000000d002', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a1'), 'absent', 'ребёнок без перевода: своя отметка на занятии группы');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d002', td(-10), td(6)) where event_type = 'training' and event_id like 'session:%'), 5, 'ребёнок без перевода: занятия своей группы U9 (a1-a4) и занятие с собственной отметкой (a8), чужой группы нет');
select is((select count(*)::int from parent_calendar('00000000-0000-0000-0000-00000000d002', td(-10), td(6)) where event_id = 'session:00000000-0000-0000-0000-0000000005a9'), 0, 'ребёнок без перевода: занятие другой группы не попадает');
select throws_ok($$select count(*) from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6))$$, '42501', 'forbidden', 'родитель Б не читает календарь ребёнка А');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select count(*) from parent_calendar('00000000-0000-0000-0000-00000000d003', td(-10), td(6))$$, '42501', 'forbidden', 'родитель А не читает календарь ребёнка В');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select count(*) from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6))$$, '42501', 'not authenticated', 'без пользователя календарь недоступен');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select count(*) from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(200))$$, '22023', 'date range too large', 'диапазон больше 180 дней отклоняется');
reset role;
update player_guardians set consent_revoked_at = now() where player_id = '00000000-0000-0000-0000-00000000d001';
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select count(*) from parent_calendar('00000000-0000-0000-0000-00000000d001', td(-10), td(6))$$, '42501', 'forbidden', 'после отзыва согласия календарь недоступен');
reset role;
select ok(has_function_privilege('authenticated', 'parent_calendar(uuid,date,date)', 'execute') and not has_function_privilege('anon', 'parent_calendar(uuid,date,date)', 'execute') and not has_function_privilege('public', 'parent_calendar(uuid,date,date)', 'execute'), 'права: authenticated да, anon и public нет (при умолчаниях Supabase)');
select * from finish();
rollback;
