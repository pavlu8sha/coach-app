-- pgTAP: личная лента тренировок игрока (0183, #266 этап 2). Условия П2.1–П2.10 из docs/PLAYER_PROFILE_ACCEPTANCE.md.
begin;
create extension if not exists pgtap;
select plan(38);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9301, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9302, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000c2', 9303, 'Тренер U11', false),
  ('00000000-0000-0000-0000-0000000000b1', 9304, 'Родитель Ани', false),
  ('00000000-0000-0000-0000-0000000000b2', 9305, 'Родитель Бори', false),
  ('00000000-0000-0000-0000-0000000000d1', 9306, 'Аня (ребёнок)', false),
  ('00000000-0000-0000-0000-0000000000f1', 9307, 'Посторонний', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2');
-- Аня сейчас в U11 (перешла из U9 10.10), ушла 01.11; Боря в U9; Вика в U11
insert into players (id, club_id, group_id, full_name, status, ends_on) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Аня', 'active', '2026-11-01'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active', null),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Вика', 'active', null);
-- история групп Ани: U9 до 10.10, затем U11 (строку вставки триггера заменяем)
delete from player_group_history where player_id = '00000000-0000-0000-0000-00000000d001';
insert into player_group_history (player_id, group_id, valid_from, valid_to) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', '1970-01-01', '2026-10-10'),
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e2', '2026-10-10', null);
-- пауза Ани 19.10–24.10
insert into player_status_log (player_id, status, on_date) values
  ('00000000-0000-0000-0000-00000000d001', 'active', '2026-09-01'),
  ('00000000-0000-0000-0000-00000000d001', 'paused', '2026-10-19'),
  ('00000000-0000-0000-0000-00000000d001', 'active', '2026-10-25');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'v1', now());
insert into child_links (user_id, player_id) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000d001');

insert into sessions (id, group_id, starts_at, source_key) values
  -- U9
  ('00000000-0000-0000-0000-000000005e01', '00000000-0000-0000-0000-0000000000e1', '2026-09-28 15:00+04', 't01'), -- до первой отметки Ани
  ('00000000-0000-0000-0000-000000005e02', '00000000-0000-0000-0000-0000000000e1', '2026-10-01 15:00+04', 't02'), -- Аня была
  ('00000000-0000-0000-0000-000000005e03', '00000000-0000-0000-0000-0000000000e1', '2026-10-03 15:00+04', 't03'), -- проведено, Аню не отметили
  ('00000000-0000-0000-0000-000000005e04', '00000000-0000-0000-0000-0000000000e1', '2026-10-05 15:00+04', 't04'), -- уважительная
  ('00000000-0000-0000-0000-000000005e05', '00000000-0000-0000-0000-0000000000e1', '2026-10-06 15:00+04', 't05'), -- никто не пришёл
  ('00000000-0000-0000-0000-000000005e06', '00000000-0000-0000-0000-0000000000e1', '2026-10-12 15:00+04', 't06'), -- U9 после перехода Ани
  -- U11
  ('00000000-0000-0000-0000-000000005e07', '00000000-0000-0000-0000-0000000000e2', '2026-10-08 15:00+04', 't07'), -- U11 до перехода Ани
  ('00000000-0000-0000-0000-000000005e08', '00000000-0000-0000-0000-0000000000e2', '2026-10-14 15:00+04', 't08'), -- Аня не была
  ('00000000-0000-0000-0000-000000005e09', '00000000-0000-0000-0000-0000000000e2', '2026-10-16 15:00+04', 't09'), -- нет отметки
  ('00000000-0000-0000-0000-000000005e10', '00000000-0000-0000-0000-0000000000e2', '2026-10-20 15:00+04', 't10'), -- пауза
  ('00000000-0000-0000-0000-000000005e11', '00000000-0000-0000-0000-0000000000e2', '2026-10-27 15:00+04', 't11'), -- нет отметки после паузы
  ('00000000-0000-0000-0000-000000005e12', '00000000-0000-0000-0000-0000000000e2', '2026-11-02 15:00+04', 't12'), -- после ухода
  ('00000000-0000-0000-0000-000000005e13', '00000000-0000-0000-0000-0000000000e2', '2099-12-01 15:00+04', 't13'), -- будущее
  -- разовое посещение U9
  ('00000000-0000-0000-0000-000000005e14', '00000000-0000-0000-0000-0000000000e1', '2026-10-22 15:00+04', 't14');
insert into attendance (session_id, player_id, status) values
  ('00000000-0000-0000-0000-000000005e01', '00000000-0000-0000-0000-00000000d002', 'present'),
  ('00000000-0000-0000-0000-000000005e02', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-000000005e02', '00000000-0000-0000-0000-00000000d002', 'absent'),
  ('00000000-0000-0000-0000-000000005e03', '00000000-0000-0000-0000-00000000d002', 'present'),
  ('00000000-0000-0000-0000-000000005e04', '00000000-0000-0000-0000-00000000d001', 'excused'),
  ('00000000-0000-0000-0000-000000005e04', '00000000-0000-0000-0000-00000000d002', 'present'),
  ('00000000-0000-0000-0000-000000005e05', '00000000-0000-0000-0000-00000000d002', 'absent'),
  ('00000000-0000-0000-0000-000000005e06', '00000000-0000-0000-0000-00000000d002', 'present'),
  ('00000000-0000-0000-0000-000000005e07', '00000000-0000-0000-0000-00000000d003', 'present'),
  ('00000000-0000-0000-0000-000000005e08', '00000000-0000-0000-0000-00000000d001', 'absent'),
  ('00000000-0000-0000-0000-000000005e08', '00000000-0000-0000-0000-00000000d003', 'present'),
  ('00000000-0000-0000-0000-000000005e09', '00000000-0000-0000-0000-00000000d003', 'present'),
  ('00000000-0000-0000-0000-000000005e10', '00000000-0000-0000-0000-00000000d003', 'present'),
  ('00000000-0000-0000-0000-000000005e11', '00000000-0000-0000-0000-00000000d003', 'present'),
  ('00000000-0000-0000-0000-000000005e12', '00000000-0000-0000-0000-00000000d003', 'present'),
  ('00000000-0000-0000-0000-000000005e13', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-000000005e14', '00000000-0000-0000-0000-00000000d002', 'present');
insert into session_guests (session_id, player_id, amount) values
  ('00000000-0000-0000-0000-000000005e14', '00000000-0000-0000-0000-00000000d001', 20);

insert into individual_sessions (id, club_id, external_id, starts_at, goalkeepers, topic) values
  ('00000000-0000-0000-0000-000000006a01', '00000000-0000-0000-0000-00000000c001', 'IND-T1', '2026-10-09 17:00', false, 'Удар'),
  ('00000000-0000-0000-0000-000000006a02', '00000000-0000-0000-0000-00000000c001', 'IND-T2', '2026-10-11 17:00', true, null),
  ('00000000-0000-0000-0000-000000006a03', '00000000-0000-0000-0000-00000000c001', 'IND-T3', '2026-10-13 17:00', false, null);
insert into individual_bookings (session_id, player_id, amount, paid, attended) values
  ('00000000-0000-0000-0000-000000006a01', '00000000-0000-0000-0000-00000000d001', 50, true, true),
  ('00000000-0000-0000-0000-000000006a02', '00000000-0000-0000-0000-00000000d001', 50, false, null),
  ('00000000-0000-0000-0000-000000006a03', '00000000-0000-0000-0000-00000000d002', 50, false, true);
insert into extra_sessions (id, club_id, starts_on, amount, place, cancelled_at) values
  ('00000000-0000-0000-0000-000000006b01', '00000000-0000-0000-0000-00000000c001', '2026-10-13', 30, 'Поле 2', null),
  ('00000000-0000-0000-0000-000000006b02', '00000000-0000-0000-0000-00000000c001', '2026-10-15', 30, 'Поле 2', now());
insert into extra_bookings (session_id, player_id, attended) values
  ('00000000-0000-0000-0000-000000006b01', '00000000-0000-0000-0000-00000000d001', false),
  ('00000000-0000-0000-0000-000000006b02', '00000000-0000-0000-0000-00000000d001', true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
-- в тестах период до 2099 обрезается сегодняшним днём, поэтому берём реальный период
create or replace function anya_rows() returns table (day date, kind text, status text, title text, group_name text) language sql as $$
  select h.day, h.kind, h.status, h.title, h.group_name
  from player_training_history('00000000-0000-0000-0000-00000000d001', (tbilisi_day(now()) - 390), tbilisi_day(now())) h
$$;

-- П2.10: только чтение, без доступа anon
select is((select provolatile::text from pg_proc where oid = 'player_training_history(uuid, date, date)'::regprocedure), 's', 'функция stable: ничего не пишет');
select ok(not has_function_privilege('anon', 'player_training_history(uuid, date, date)', 'execute'), 'anon не может вызвать функцию');
select ok(has_function_privilege('authenticated', 'player_training_history(uuid, date, date)', 'execute'), 'authenticated может вызвать (проверка прав внутри)');
-- П2.9: в ответе нет идентификаторов, имён, сумм и оплат
select is(pg_get_function_result('player_training_history(uuid, date, date)'::regprocedure),
  'TABLE(day date, starts_at time without time zone, kind text, title text, group_name text, status text)', 'ответ: дата, время, вид, название, группа, статус (без id, имён, сумм)');

-- П2.3–П2.8: состав ленты (родитель)
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from anya_rows()), 10, 'у Ани 10 строк за период');
select is((select status from anya_rows() where day = '2026-10-01'), 'present', 'отмеченное посещение показано');
select is((select group_name from anya_rows() where day = '2026-10-01'), 'U9', 'групповое занятие подписано группой');
select is((select status from anya_rows() where day = '2026-10-03'), 'unmarked', 'проведённое занятие своей группы без отметки: «нет отметки»');
select is((select status from anya_rows() where day = '2026-10-05'), 'excused', 'уважительная причина');
select is((select status from anya_rows() where day = '2026-10-14'), 'absent', 'не был');
select is((select status from anya_rows() where day = '2026-10-16'), 'unmarked', 'после перехода: занятие новой группы без отметки');
select is((select status from anya_rows() where day = '2026-10-27'), 'unmarked', 'после паузы снова показываются занятия без отметки');
select ok(not exists (select 1 from anya_rows() where day = '2026-09-28'), 'занятие до первой отметки игрока не показано');
select ok(not exists (select 1 from anya_rows() where day = '2026-10-06'), 'непроведённое занятие (никто не пришёл) не показано');
select ok(not exists (select 1 from anya_rows() where day = '2026-10-12'), 'занятие прежней группы после перехода не показано');
select ok(not exists (select 1 from anya_rows() where day = '2026-10-08'), 'занятие новой группы до перехода не показано');
select ok(not exists (select 1 from anya_rows() where day = '2026-10-20'), 'занятие во время паузы не показано');
select ok(not exists (select 1 from anya_rows() where day = '2026-11-02'), 'занятие после ухода (ends_on) не показано');
select ok(not exists (select 1 from anya_rows() where day > tbilisi_day(now())), 'будущее не показывается, даже с отметкой');
select is((select array[kind, status, title] from anya_rows() where day = '2026-10-22'), array['guest', 'present', 'Разовое посещение: U9'], 'разовое посещение другой группы');
select is((select array[kind, status, title] from anya_rows() where day = '2026-10-09'), array['individual', 'present', 'Индивидуальная тренировка: Удар'], 'индивидуальное: был');
select is((select array[kind, status] from anya_rows() where day = '2026-10-11'), array['goalkeeper', 'unmarked'], 'вратарское без отметки');
select ok(not exists (select 1 from anya_rows() where day = '2026-10-13' and kind = 'individual'), 'чужая индивидуальная запись не попадает');
select is((select array[kind, status] from anya_rows() where day = '2026-10-13'), array['extra', 'absent'], 'дополнительное: не пришла');
select ok(not exists (select 1 from anya_rows() where day = '2026-10-15'), 'отменённое дополнительное занятие не показано');
select is((select day from anya_rows() limit 1), date '2026-10-27', 'порядок: от новых к старым');

-- П2.1: доступ
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from anya_rows()), 10, 'администратор видит ленту');
select as_user('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from anya_rows()), 10, 'тренер текущей группы видит ленту');
select as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from anya_rows()), 10, 'ребёнок видит свою ленту');
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select * from anya_rows()$$, '42501', 'forbidden', 'тренер другой группы не видит (правило 0042 не распространяется)');
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select * from anya_rows()$$, '42501', 'forbidden', 'родитель другого ребёнка не видит');
select as_user('00000000-0000-0000-0000-0000000000f1');
select throws_ok($$select * from anya_rows()$$, '42501', 'forbidden', 'посторонний не видит');
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select * from anya_rows()$$, '42501', 'not authenticated', 'без входа: not authenticated');

-- П2.2: период
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from player_training_history('00000000-0000-0000-0000-00000000d001', '2026-10-31', '2026-10-01')$$, '22023', 'bad period', 'перевёрнутый период');
select throws_ok($$select * from player_training_history('00000000-0000-0000-0000-00000000d001', null, '2026-10-01')$$, '22023', 'bad period', 'пустой период');
select throws_ok($$select * from player_training_history('00000000-0000-0000-0000-00000000d001', '2025-01-01', '2026-10-01')$$, '22023', 'period too large', 'больше 400 дней');

-- отзыв доступа родителем закрывает ленту и родителю, и ребёнку
reset role;
update player_guardians set consent_revoked_at = now() where player_id = '00000000-0000-0000-0000-00000000d001';
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from anya_rows()$$, '42501', 'forbidden', 'после отзыва согласия родитель не видит');
select as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select * from anya_rows()$$, '42501', 'forbidden', 'после отзыва согласия ребёнок не видит');

select * from finish();
rollback;
