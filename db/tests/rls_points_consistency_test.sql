-- pgTAP: сверка журнала баллов (0127). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(11);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7401, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7402, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 7403, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'G1');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера (пауза)', 'paused');
insert into rules (club_id, code, points, explanation, active_from)
  values ('00000000-0000-0000-0000-00000000c001', 'attendance_present', 1, 'Тренировка', date '2026-01-01');
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-12-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));

-- занятие и матч без счёта
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-12-03 15:00+04', 'training', 'ATT|2026-12-03', 'regular');
insert into matches (id, club_id, played_on, team, goals_for, goals_against)
  values ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000c001', '2026-12-05', 'U10', null, null);
insert into match_players (match_id, player_id, played) values ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000d001', true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- ручная правка в обход триггеров (как из SQL Editor с отключёнными триггерами)
set session_replication_role = replica;
insert into attendance (session_id, player_id, status) values ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 'present');
set session_replication_role = origin;
select is((select count(*)::int from points_ledger), 0, 'журнал расходится с отметкой');

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select points_consistency(false)$$, '42501', 'forbidden', 'тренер не запускает сверку');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select points_consistency(true)$$, '42501', 'forbidden', 'родитель не запускает сверку');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select (points_consistency(false) ->> 'changes')::int), 1, 'сверка находит одно расхождение');
select is((select points_consistency(false) -> 'drift' -> 0 ->> 'source_type'), 'group_session', 'тип источника указан');
select is((select jsonb_array_length(points_consistency(false) -> 'exceptions')), 1, 'матч без счёта попал в исключения');
reset role;
select is((select count(*)::int from points_ledger), 0, 'проверка без fix ничего не меняет');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select (points_consistency(true) ->> 'changes')::int), 1, 'fix применяет одно исправление');
reset role;
select is((select points from points_ledger where status = 'active'), 1, 'в журнале появилась строка +1');
select is((select count(*)::int from audit_log where action = 'points_consistency_fix'), 1, 'исправление записано в аудит');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select (points_consistency(false) ->> 'changes')::int), 0, 'после исправления расхождений нет');

select * from finish();
rollback;
