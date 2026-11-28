-- pgTAP: история и баллы индивидуальных занятий зависят от attended, а не от paid (#764, Problem B; правило #18, П2.7).
-- Матрица: paid × attended -> статус истории и баллы. Продуктовые правила не меняются. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(22);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1', 7701, 'Админ', true);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'G1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active');
insert into rules (club_id, code, points, explanation, active_from)
  values ('00000000-0000-0000-0000-00000000c001', 'attendance_present', 1, 'Тренировка', date '2026-01-01');
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-01-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));

-- по одному занятию на клетку матрицы
insert into individual_sessions (id, club_id, external_id, starts_at, goalkeepers) values
  ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-00000000c001', 'M-1', '2026-10-05 17:00', false), -- paid=true,  attended=null
  ('00000000-0000-0000-0000-0000000006b2', '00000000-0000-0000-0000-00000000c001', 'M-2', '2026-10-06 17:00', false), -- paid=true,  attended=false
  ('00000000-0000-0000-0000-0000000006b3', '00000000-0000-0000-0000-00000000c001', 'M-3', '2026-10-07 17:00', false), -- paid=false, attended=true
  ('00000000-0000-0000-0000-0000000006b4', '00000000-0000-0000-0000-00000000c001', 'M-4', '2026-10-08 17:00', false), -- paid=true,  attended=true
  ('00000000-0000-0000-0000-0000000006b5', '00000000-0000-0000-0000-00000000c001', 'M-5', '2026-10-09 17:00', false); -- paid=false, attended=null
insert into individual_bookings (session_id, player_id, amount, paid, attended) values
  ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-00000000d001', 50, true,  null),
  ('00000000-0000-0000-0000-0000000006b2', '00000000-0000-0000-0000-00000000d001', 50, true,  false),
  ('00000000-0000-0000-0000-0000000006b3', '00000000-0000-0000-0000-00000000d001', 50, false, true),
  ('00000000-0000-0000-0000-0000000006b4', '00000000-0000-0000-0000-00000000d001', 50, true,  true),
  ('00000000-0000-0000-0000-0000000006b5', '00000000-0000-0000-0000-00000000d001', 50, false, null);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function hist(d date) returns text language sql as $$
  select status from player_training_history('00000000-0000-0000-0000-00000000d001', date '2026-10-01', date '2026-10-31') where day = d and kind = 'individual'
$$;
create or replace function pts(s uuid) returns int language sql as $$
  select coalesce(sum(points), 0)::int from points_ledger where source_type = 'individual' and source_id = s and status = 'active'
$$;

-- история (читает администратор): статус по attended
select as_user('00000000-0000-0000-0000-0000000000a1');
select is(hist('2026-10-05'), 'unmarked', 'paid=true, attended=null: «нет отметки» (оплата не доказывает посещение)');
select is(hist('2026-10-06'), 'absent',   'paid=true, attended=false: «не был»');
select is(hist('2026-10-07'), 'present',  'paid=false, attended=true: «был»');
select is(hist('2026-10-08'), 'present',  'paid=true, attended=true: «был»');
select is(hist('2026-10-09'), 'unmarked', 'paid=false, attended=null: «нет отметки»');
reset role;

-- баллы: только за attended=true, оплата роли не играет
select is(pts('00000000-0000-0000-0000-0000000006b1'), 0, 'paid=true, attended=null: баллов нет');
select is(pts('00000000-0000-0000-0000-0000000006b2'), 0, 'paid=true, attended=false: баллов нет');
select is(pts('00000000-0000-0000-0000-0000000006b3'), 2, 'paid=false, attended=true: +2');
select is(pts('00000000-0000-0000-0000-0000000006b4'), 2, 'paid=true, attended=true: +2');
select is(pts('00000000-0000-0000-0000-0000000006b5'), 0, 'paid=false, attended=null: баллов нет');
select is((select count(*)::int from points_ledger where source_type = 'individual' and status = 'active'), 2, 'всего две действующие строки (по attended=true)');

-- оплата не создаёт и не снимает баллы
update individual_bookings set paid = not paid;
select is(pts('00000000-0000-0000-0000-0000000006b1'), 0, 'смена оплаты у attended=null баллов не даёт');
select is(pts('00000000-0000-0000-0000-0000000006b3'), 2, 'смена оплаты у attended=true баллы не снимает');
select is((select count(*)::int from points_ledger where source_type = 'individual' and status = 'active'), 2, 'смена оплаты не меняет число строк');

-- повторное сохранение attended=true не создаёт дубль
update individual_bookings set attended = true where session_id = '00000000-0000-0000-0000-0000000006b4';
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000006b4' and source_type = 'individual'), 1, 'повторное attended=true: дубля нет');

-- true -> false закрывает начисление, строка отменена, а не удалена
update individual_bookings set attended = false where session_id = '00000000-0000-0000-0000-0000000006b3';
select is(pts('00000000-0000-0000-0000-0000000006b3'), 0, 'true -> false: действующих баллов нет');
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000006b3' and source_type = 'individual' and status = 'cancelled'), 1, 'строка отменена, не удалена');

-- null/false -> true создаёт начисление
update individual_bookings set attended = true where session_id = '00000000-0000-0000-0000-0000000006b1';
update individual_bookings set attended = true where session_id = '00000000-0000-0000-0000-0000000006b2';
select is(pts('00000000-0000-0000-0000-0000000006b1'), 2, 'null -> true: +2');
select is(pts('00000000-0000-0000-0000-0000000006b2'), 2, 'false -> true: +2');
-- возврат true -> false -> true не накапливает действующие дубли
update individual_bookings set attended = false where session_id = '00000000-0000-0000-0000-0000000006b2';
update individual_bookings set attended = true where session_id = '00000000-0000-0000-0000-0000000006b2';
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000006b2' and source_type = 'individual' and status = 'active'), 1, 'true -> false -> true: одна действующая строка');
-- история после правок следует за attended
select as_user('00000000-0000-0000-0000-0000000000a1');
select is(hist('2026-10-07'), 'absent', 'после true -> false история «не был»');
select is(hist('2026-10-05'), 'present', 'после null -> true история «был»');
reset role;

select * from finish();
rollback;
