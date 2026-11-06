-- pgTAP: баллы за тренировки в новом журнале (0121). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(31);

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

-- занятия
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-12-03 15:00+04', 'training', 'ATT|2026-12-03', 'regular'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000e1', '2026-12-04 15:00+04', 'training', 'ATT|2026-12-04', 'moved'),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000000e1', '2026-12-05 12:00+04', 'training', 'ATT|2026-12-05|u', 'unscheduled'),
  ('00000000-0000-0000-0000-0000000005a0', '00000000-0000-0000-0000-0000000000e1', '2026-11-20 15:00+04', 'training', 'ATT|2026-11-20', 'regular');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');

-- до даты вступления правил: частичный список допустим, в новом журнале ничего нет
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005a0', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"}]')$$, 'до запуска частичный список сохраняется');
reset role;
select is((select count(*)::int from points_ledger), 0, 'до запуска в новом журнале нет начислений');
select as_user('00000000-0000-0000-0000-0000000000c1');

-- после запуска: неполный список отклоняется целиком
select throws_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005a1', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"}]')$$, '22023', 'roster incomplete', 'неполный список отклоняется');
reset role;
select is((select count(*)::int from attendance where session_id = '00000000-0000-0000-0000-0000000005a1'), 0, 'при отказе отметки не сохраняются');
select as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select mark_attendance('00000000-0000-0000-0000-0000000005a1', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"absent"}]')$$, 'игрок на паузе отметки не требует');
reset role;
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and status = 'active'), 1, 'один «Был» = одна действующая строка');
select is((select points from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and status = 'active'), 1, 'обычная групповая +1');
select is((select group_id from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1'), '00000000-0000-0000-0000-0000000000e1'::uuid, 'группа записана');
select is((select rule_version_id from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1'), '00000000-0000-0000-0000-0000000000f1'::uuid, 'версия правила записана');

-- повтор
select as_user('00000000-0000-0000-0000-0000000000c1');
select mark_attendance('00000000-0000-0000-0000-0000000005a1', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"absent"}]');
reset role;
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1'), 1, 'повторное сохранение не создаёт дубль');
select is((select count(*)::int from points_ledger_audit where source_id = '00000000-0000-0000-0000-0000000005a1'), 1, 'повтор не пишет аудит');

-- исправление Был -> Не был -> Был
select as_user('00000000-0000-0000-0000-0000000000c1');
select mark_attendance('00000000-0000-0000-0000-0000000005a1', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"excused"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"absent"}]');
reset role;
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and status = 'active'), 0, 'Был -> Не был: балл снят');
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and status = 'cancelled'), 1, 'строка отменена, а не удалена');
select as_user('00000000-0000-0000-0000-0000000000c1');
select mark_attendance('00000000-0000-0000-0000-0000000005a1', '[{"player_id":"00000000-0000-0000-0000-00000000d001","status":"present"},{"player_id":"00000000-0000-0000-0000-00000000d002","status":"present"}]');
reset role;
select is((select sum(points)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and status = 'active'), 2, 'Не был -> Был: баллы начислены по одному на игрока');

-- правка из SQL Editor тоже согласует журнал
update attendance set status = 'absent' where session_id = '00000000-0000-0000-0000-0000000005a1' and player_id = '00000000-0000-0000-0000-00000000d002';
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a1' and status = 'active'), 1, 'ручная правка отметки сразу меняет журнал');

-- типы занятий
insert into attendance (session_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-00000000d001', 'present');
select is((select points from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a2' and status = 'active'), 1, 'перенесённая +1');
select is((select points from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a3' and status = 'active'), 2, 'внеплановая +2');
update sessions set class = 'regular' where id = '00000000-0000-0000-0000-0000000005a3';
select is((select points from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a3' and status = 'active'), 1, 'смена типа занятия пересчитывает баллы');
delete from sessions where id = '00000000-0000-0000-0000-0000000005a3';
select is((select count(*)::int from points_ledger where source_id = '00000000-0000-0000-0000-0000000005a3' and status = 'active'), 0, 'удаление занятия отменяет баллы');

-- индивидуальные и вратарские
insert into individual_sessions (id, club_id, external_id, starts_at, goalkeepers) values
  ('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-00000000c001', 'IND-1', '2026-12-05 19:00', false),
  ('00000000-0000-0000-0000-0000000006a2', '00000000-0000-0000-0000-00000000c001', 'IND-2', '2026-12-06 19:00', true);
insert into individual_bookings (session_id, player_id) values
  ('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-00000000d001'),
  ('00000000-0000-0000-0000-0000000006a2', '00000000-0000-0000-0000-00000000d001');
select is((select count(*)::int from points_ledger where source_type in ('individual', 'goalkeeper')), 0, 'запись и оплата баллов не дают');
update individual_bookings set attended = true;
select is((select points from points_ledger where source_type = 'individual' and status = 'active'), 2, 'индивидуальная +2');
select is((select points from points_ledger where source_type = 'goalkeeper' and status = 'active'), 2, 'вратарская +2');
update individual_bookings set attended = false where session_id = '00000000-0000-0000-0000-0000000006a1';
select is((select count(*)::int from points_ledger where source_type = 'individual' and status = 'active'), 0, '«Не был» снимает баллы');
update individual_sessions set goalkeepers = false where id = '00000000-0000-0000-0000-0000000006a2';
select is((select count(*)::int from points_ledger where source_type = 'goalkeeper' and status = 'active'), 0, 'смена вида занятия закрывает прежний вид');
select is((select count(*)::int from points_ledger where source_type = 'individual' and status = 'active'), 1, 'и начисляет по новому виду');

-- дополнительные
insert into extra_sessions (id, club_id, starts_on) values ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000c001', '2026-12-07');
insert into extra_bookings (session_id, player_id) values ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000d001');
update extra_bookings set attended = true;
select is((select points from points_ledger where source_type = 'extra' and status = 'active'), 2, 'дополнительная +2');
delete from extra_bookings;
select is((select count(*)::int from points_ledger where source_type = 'extra' and status = 'active'), 0, 'удаление записи снимает баллы');
-- отмена занятия клубом: баллы за посещение снимаются, повторно не начисляются
insert into extra_bookings (session_id, player_id, attended) values ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000d001', true);
select is((select count(*)::int from points_ledger where source_type = 'extra' and status = 'active'), 1, 'до отмены баллы начислены');
update extra_sessions set cancelled_at = now() where id = '00000000-0000-0000-0000-0000000007a1';
select is((select count(*)::int from points_ledger where source_type = 'extra' and status = 'active'), 0, 'отмена занятия снимает баллы');
update extra_bookings set attended = true;
select is((select count(*)::int from points_ledger where source_type = 'extra' and status = 'active'), 0, 'на отменённом занятии баллы не начисляются');
delete from extra_bookings;

-- родитель видит свои баллы и не видит чужие (ребёнок не привязан)
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from points_ledger), 0, 'не привязанный родитель не видит баллы');

select * from finish();
rollback;
