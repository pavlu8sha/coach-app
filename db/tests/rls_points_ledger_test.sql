-- pgTAP: журнал начислений баллов (0118). Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(23);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 7201, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 7202, 'Тренер 1', false),
  ('00000000-0000-0000-0000-0000000000c2', 7203, 'Тренер 2', false),
  ('00000000-0000-0000-0000-0000000000b1', 7204, 'Родитель 1', false),
  ('00000000-0000-0000-0000-0000000000b2', 7205, 'Родитель 2', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'G1'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'G2');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Боря', 'active');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b2', 'v1', now());
insert into points_rule_versions (id, club_id, effective_from, params) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2026-12-01', '{}');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- ожидаемое начисление: Аня +1, Боря +2 за одно занятие
create temp table exp1 as select jsonb_build_array(
  jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d001', 'group_id', '00000000-0000-0000-0000-0000000000e1', 'event_date', '2026-12-03', 'reason_code', 'attended', 'points', 1, 'components', '{"base":1}'::jsonb, 'rule_version_id', '00000000-0000-0000-0000-0000000000f1'),
  jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d002', 'group_id', '00000000-0000-0000-0000-0000000000e2', 'event_date', '2026-12-03', 'reason_code', 'attended', 'points', 2, 'components', '{}'::jsonb, 'rule_version_id', '00000000-0000-0000-0000-0000000000f1')
) as x;
grant select on exp1 to authenticated;

select is(points_ledger_apply('00000000-0000-0000-0000-00000000c001', 'individual', '00000000-0000-0000-0000-0000000000aa', (select x from exp1)), 2, 'первое согласование создаёт две строки');
select is(points_ledger_apply('00000000-0000-0000-0000-00000000c001', 'individual', '00000000-0000-0000-0000-0000000000aa', (select x from exp1)), 0, 'повтор ничего не меняет');
select is((select count(*)::int from points_ledger), 2, 'дублей нет');
select is((select count(*)::int from points_ledger_audit), 2, 'повтор не пишет аудит');
select is((select month from points_ledger limit 1), date '2026-12-01', 'месяц считается от даты события');

-- изменение: Ане теперь +2, Боря исчез из ожидаемого
select is(points_ledger_apply('00000000-0000-0000-0000-00000000c001', 'individual', '00000000-0000-0000-0000-0000000000aa',
  jsonb_build_array(jsonb_build_object('player_id', '00000000-0000-0000-0000-00000000d001', 'group_id', '00000000-0000-0000-0000-0000000000e1', 'event_date', '2026-12-03', 'reason_code', 'attended', 'points', 2, 'components', '{"base":1}'::jsonb, 'rule_version_id', '00000000-0000-0000-0000-0000000000f1')),
  'исправление отметки'), 2, 'исправление: одна замена и одна отмена');
select is((select count(*)::int from points_ledger where status = 'active'), 1, 'действующая строка одна');
select is((select points from points_ledger where status = 'active'), 2, 'в действующей строке новые баллы');
select is((select count(*)::int from points_ledger where status = 'superseded'), 1, 'старая строка осталась со статусом superseded');
select is((select count(*)::int from points_ledger where status = 'cancelled' and cancel_reason = 'исправление отметки'), 1, 'исчезнувшее основание отменено с причиной');
select is((select supersedes_id is not null from points_ledger where status = 'active'), true, 'новая строка ссылается на прежнюю');
select is((select count(*)::int from points_ledger_audit where action in ('supersede', 'cancel')), 2, 'исправления записаны в аудит');

-- неизменность
select throws_ok($$delete from points_ledger$$, '42501', 'points ledger rows cannot be deleted', 'удалить строку журнала нельзя');
select throws_ok($$update points_ledger set points = 99 where status = 'active'$$, '42501', 'points ledger row can only be closed', 'править баллы нельзя');
select throws_ok($$update points_ledger set status = 'active', closed_at = null where status = 'superseded'$$, '42501', 'closed points ledger row cannot be changed', 'закрытую строку не открыть');
select throws_ok($$delete from points_ledger_audit$$, '42501', 'points ledger audit is append-only', 'аудит не удаляется');
select throws_ok($$insert into points_ledger (club_id, player_id, event_date, source_type, source_id, reason_code, points) values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000d001', '2026-12-03', 'manual', gen_random_uuid(), 'x', -1)$$, '23514', null, 'отрицательные баллы запрещены');

-- восстановим вторую строку для проверок доступа
select points_ledger_apply('00000000-0000-0000-0000-00000000c001', 'individual', '00000000-0000-0000-0000-0000000000bb', (select x from exp1));

-- доступ
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select array_agg(distinct player_id::text) from points_ledger), array['00000000-0000-0000-0000-00000000d001'], 'родитель видит только строки своего ребёнка');
select is((select count(*)::int from points_ledger where status <> 'active'), 0, 'родитель не видит исправленные строки');
select throws_ok($$select points_ledger_apply('00000000-0000-0000-0000-00000000c001', 'manual', gen_random_uuid(), '[]')$$, '42501', null, 'приложение не вызывает движок');
select as_user('00000000-0000-0000-0000-0000000000c2');
select is((select array_agg(distinct player_id::text) from points_ledger), array['00000000-0000-0000-0000-00000000d002'], 'тренер видит только игроков своей группы');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from points_ledger_audit) > 0, true, 'админ читает аудит');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from points_ledger_audit), 0, 'родитель не видит аудит');

select * from finish();
rollback;
