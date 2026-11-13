-- pgTAP: полнота состава при правке отметки задним числом (PTS-03). Условия: docs/ROSTER_ON_DATE_ACCEPTANCE.md. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(12);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7501, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7502, 'Тренер', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'G1');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
-- d001 и d002 активны всегда; d003 вступил 2026-12-10; d004 выбыл 2026-11-20; d005 активен до 2026-12-20, потом пауза
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Гоша (вернулся позже)', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ира (выбыла)', 'inactive'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Зоя (пауза позже)', 'paused');
insert into player_status_log (player_id, status, on_date) values
  ('00000000-0000-0000-0000-00000000d003', 'inactive', date '2026-11-01'),
  ('00000000-0000-0000-0000-00000000d003', 'active', date '2026-12-10'),
  ('00000000-0000-0000-0000-00000000d004', 'active', date '2026-01-01'),
  ('00000000-0000-0000-0000-00000000d004', 'inactive', date '2026-11-20'),
  ('00000000-0000-0000-0000-00000000d005', 'active', date '2026-01-01'),
  ('00000000-0000-0000-0000-00000000d005', 'paused', date '2026-12-20');
insert into rules (club_id, code, points, explanation, active_from)
  values ('00000000-0000-0000-0000-00000000c001', 'attendance_present', 1, 'Тренировка', date '2026-01-01');
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-12-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));

-- занятия: до вступления Гоши (12-03), после (12-11), до выбытия Иры и после паузы Зои
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000000e1', '2026-12-03 15:00+04', 'training', 'ATT|2026-12-03', 'regular'),
  ('00000000-0000-0000-0000-0000000005b2', '00000000-0000-0000-0000-0000000000e1', '2026-12-11 15:00+04', 'training', 'ATT|2026-12-11', 'regular'),
  ('00000000-0000-0000-0000-0000000005b3', '00000000-0000-0000-0000-0000000000e1', '2026-12-25 15:00+04', 'training', 'ATT|2026-12-25', 'regular'),
  ('00000000-0000-0000-0000-0000000005b4', '00000000-0000-0000-0000-0000000000e1', '2026-12-09 15:00+04', 'training', 'ATT|2026-12-09', 'regular'),
  ('00000000-0000-0000-0000-0000000005b6', '00000000-0000-0000-0000-0000000000e1', '2026-12-08 15:00+04', 'training', 'ATT|2026-12-08', 'regular'),
  ('00000000-0000-0000-0000-0000000005b5', '00000000-0000-0000-0000-0000000000e1', '2026-11-20 15:00+04', 'training', 'ATT|2026-11-20', 'regular');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select as_user('00000000-0000-0000-0000-0000000000c1');

-- 1. Гоша вступил 12-10: на занятии 12-03 его нет в составе, правка без него проходит (раньше падало)
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005b1', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"absent"},{"player_id":"00000000-0000-0000-0000-00000000d005","status":"absent"}]')$$, 'вступивший позже игрок не блокирует правку прошлого занятия');
reset role;
select is((select count(*)::int from attendance where session_id = '00000000-0000-0000-0000-0000000005b1' and player_id = '00000000-0000-0000-0000-00000000d003'), 0, 'вступивший позже отметки не получает');
select as_user('00000000-0000-0000-0000-0000000000c1');

-- 2. правка одной отметки на том же занятии: Аня была, стала «Не был», сохраняется полный состав на дату
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005b1', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"excused"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"absent"},{"player_id":"00000000-0000-0000-0000-00000000d005","status":"present"}]')$$, 'исправление отметки задним числом сохраняется');
reset role;
select is((select status from attendance where session_id = '00000000-0000-0000-0000-0000000005b1' and player_id = '00000000-0000-0000-0000-00000000d001'), 'excused', 'исправленная отметка записана');
select as_user('00000000-0000-0000-0000-0000000000c1');

-- 3. 12-09: Гоша ещё не вернулся (с 12-10), Ира выбыла раньше; состав из тех, кто активен в эту дату
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005b4', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d005","status":"present"}]')$$, 'не вернувшийся и выбывший в состав не входят');

-- 4. Гоша на 12-11 активен: его отсутствие по-прежнему отклоняется
select throws_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005b2', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d005","status":"present"}]')$$, '22023', 'roster incomplete', 'игрок, активный на дату занятия, обязателен');
reset role;
select is((select count(*)::int from attendance where session_id = '00000000-0000-0000-0000-0000000005b2'), 0, 'при отказе отметки не сохраняются');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005b2', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d003","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d005","status":"present"}]')$$, 'полный состав на дату сохраняется');

-- 5. Зоя на паузе с 12-20: на 12-08 она активна, поэтому обязательна (как на экране)
select throws_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005b6', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"present"}]')$$, '22023', 'roster incomplete', 'позже выбывший, но активный на дату, обязателен');
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005b6', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d005","status":"present"}]')$$, 'с ней полный состав сохраняется');
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005b3', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d003","status":"present"}]')$$, 'на паузе после 12-20 (12-25) Зоя не требуется');

-- 6. дата вступления правил: до 2026-12-01 проверки состава нет
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005b5', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"}]')$$, 'до даты правил состав не проверяется');

select * from finish();
rollback;
