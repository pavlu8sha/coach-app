-- pgTAP: тестовый запуск баллов и points_start (0129). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(9);

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

insert into points_rule_versions (id, club_id, effective_from, params)
  select '00000000-0000-0000-0000-0000000000f0', club_id, date '2026-11-06', params from points_rule_versions where effective_from = '2026-12-01';

insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-11-10 15:00+04', 'training', 'ATT|2026-11-10', 'regular'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000e1', '2026-12-03 15:00+04', 'training', 'ATT|2026-12-03', 'regular');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- тестовый режим: ноябрьское занятие считается
insert into attendance (session_id, player_id, status) values ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 'present');
select is((select count(*)::int from points_ledger where status = 'active'), 1, 'в тестовом режиме ноябрьское занятие даёт балл');

-- дата старта 1 декабря: ноябрь закрывается
select as_user('00000000-0000-0000-0000-0000000000a1');
select set_points_start(date '2026-12-01');
set constraints all immediate;
reset role;
select is((select count(*)::int from points_ledger where status = 'active'), 0, 'после даты старта ноябрьских начислений нет');
select is((select count(*)::int from points_ledger where status = 'cancelled'), 1, 'ноябрьская строка закрыта, а не удалена');
select is((points_rules_for('00000000-0000-0000-0000-00000000c001', date '2026-11-10')).id is null, true, 'правил на дату до старта нет');

-- декабрь считается
insert into attendance (session_id, player_id, status) values ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d001', 'present');
select is((select count(*)::int from points_ledger where status = 'active' and event_date = '2026-12-03'), 1, 'декабрьское занятие считается');

-- до даты старта полный список не требуется
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005a1', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"}]')$$, 'до даты старта частичный список сохраняется');
select throws_ok($$select points_consistency(false)$$, '42501', 'forbidden', 'тренер не запускает сверку');

-- снятие даты возвращает тестовые начисления
select as_user('00000000-0000-0000-0000-0000000000a1');
select set_points_start(null);
set constraints all immediate;
reset role;
select is((select count(*)::int from points_ledger where status = 'active' and event_date = '2026-11-10'), 1, 'после снятия даты ноябрьский балл вернулся');
select is((select (points_consistency_run(false) ->> 'changes')::int), 0, 'после пересчёта расхождений нет');

select * from finish();
rollback;
