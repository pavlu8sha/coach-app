-- pgTAP: исключения сверки с начала подсчёта (0131). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(3);

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
  select '00000000-0000-0000-0000-0000000000f0', club_id, date '2026-11-01', params from points_rule_versions where effective_from = '2026-12-01';
insert into matches (id, club_id, played_on, team, goals_for, goals_against) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000c001', '2026-10-10', 'U9', null, null),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000c001', '2026-11-03', 'U9', null, null);
insert into match_players (match_id, player_id, played) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000d001', true),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000d001', true);

select is((select jsonb_array_length(points_consistency_run(false) -> 'exceptions')), 1, 'старый матч без счёта в исключения не попадает');
select is((select points_consistency_run(false) -> 'exceptions' -> 0 ->> 'source_id'), '00000000-0000-0000-0000-00000000aa02', 'остаётся матч с начала подсчёта');

-- дата старта сдвигает начало подсчёта
insert into club_settings (club_id, key, value, scope, updated_at) values ('00000000-0000-0000-0000-00000000c001', 'points_start', '2026-12-01', '', current_date);
select is((select jsonb_array_length(points_consistency_run(false) -> 'exceptions')), 0, 'после даты старта 1 декабря исключений нет');

select * from finish();
rollback;
