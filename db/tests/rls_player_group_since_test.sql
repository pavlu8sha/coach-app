-- pgTAP (0219): player_group_since(): перенос начала группы задним числом и пересчёт баллов. Только синтетические данные.
-- Условия приёмки: docs/acceptance/group-since-2026-11-21.md (G1-G12). Даты считаются от текущего дня, тест не зависит от календаря.
begin;
create extension if not exists pgtap;
select plan(32);

create function tx(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
create function dd(n int) returns date language sql stable as $$ select tbilisi_day(now()) + n $$;
create function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function as_nobody() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- Клуб 1; админ 10; родитель 21 (ребёнок K); группы: 2 «Индивидуальные», 3 «U9-B»; игроки: K (31, с ручным начислением), M (32, без него), S (33, одна группа)
insert into clubs (id, name) values (tx(1), 'Клуб');
insert into users (id, telegram_id, display_name, is_admin, club_id) values (tx(10), 7110, 'Админ', true, tx(1)), (tx(21), 7121, 'Родитель K', false, tx(1));
insert into groups (id, club_id, name) values (tx(2), tx(1), 'Индивидуальные / Вратарские'), (tx(3), tx(1), 'U9-B');
insert into players (id, club_id, group_id, full_name, status) values
  (tx(31), tx(1), tx(3), 'Синтетик К', 'active'), (tx(32), tx(1), tx(3), 'Синтетик М', 'active'), (tx(33), tx(1), tx(3), 'Синтетик С', 'active');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values (tx(31), tx(21), 'v1', now());
-- история групп: K и M были в группе 2 до «сегодня - 5 дней», затем в группе 3; S всё время в группе 3
delete from player_group_history where player_id in (tx(31), tx(32));
insert into player_group_history (player_id, group_id, valid_from, valid_to) values
  (tx(31), tx(2), date '1970-01-01', dd(-5)), (tx(31), tx(3), dd(-5), null),
  (tx(32), tx(2), date '1970-01-01', dd(-5)), (tx(32), tx(3), dd(-5), null);
insert into points_rule_versions (id, club_id, effective_from, params) values (tx(90), tx(1), date '2026-01-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));
-- индивидуальные занятия: два до перевода (в периоде переноса) и одно после перевода
insert into individual_sessions (id, club_id, external_id, starts_at, topic) values
  (tx(51), tx(1), 'IND-T-1', (dd(-19) + time '18:00')::timestamp, 'т1'), (tx(52), tx(1), 'IND-T-2', (dd(-12) + time '18:00')::timestamp, 'т2'), (tx(53), tx(1), 'IND-T-3', (dd(-3) + time '18:00')::timestamp, 'т3');
insert into individual_bookings (session_id, player_id, attended) select s, p, true from unnest(array[tx(51), tx(52), tx(53)]) s, unnest(array[tx(31), tx(32)]) p;
-- ручное начисление K в группе 2 (журнал неизменен, перенос его не затрагивает)
insert into points_ledger (club_id, player_id, group_id, event_date, source_type, source_id, reason_code, points, components, rule_version_id)
  values (tx(1), tx(31), tx(2), dd(-10), 'manual', tx(99), 'manual', 1, '{}'::jsonb, tx(90));
create temp table tot as select player_id, sum(points)::int as pts from points_ledger where status = 'active' group by player_id;
grant select on tot to public;
create temp table q0 as select count(*)::int as n from notifications;
create temp table aud0 as select count(*)::int as n from points_ledger_audit;
grant select on q0, aud0 to public;

select is((select count(*)::int from points_ledger where player_id = tx(31) and status = 'active' and group_id = tx(2)), 3, 'старт: у K три действующих строки в группе 2 (два индивидуальных и ручная)');
select is((select count(distinct group_id)::int from points_ledger where player_id = tx(32) and status = 'active'), 2, 'старт: у M начисления в двух группах');

-- G1 предпросмотр
select as_user(tx(10));
select is((select player_group_since(tx(31), dd(-20), false) ->> 'ledger_rows')::int, 3, 'G1: предпросмотр: три строки в периоде (два индивидуальных и ручная)');
select is((select player_group_since(tx(31), dd(-20), false) ->> 'manual_rows')::int, 1, 'G1: предпросмотр: одна ручная');
select is((select player_group_since(tx(31), dd(-20), false) ->> 'changed')::int, 0, 'G1: предпросмотр ничего не меняет (changed = 0)');
select is((select (player_group_since(tx(31), dd(-20), false) ->> 'from')::date), dd(-5), 'G1: from = прежнее начало группы');
select is((select (player_group_since(tx(31), dd(-20), false) ->> 'to')::date), dd(-20), 'G1: to = новая дата');
reset role;
select is((select valid_from from player_group_history where player_id = tx(31) and valid_to is null), dd(-5), 'G1: история после предпросмотра не изменилась');

-- ошибки G9 (ничего не меняется)
select as_user(tx(21));
select throws_ok($$select player_group_since('00000000-0000-0000-0000-000000000020'::uuid, current_date, false)$$, '42501', 'forbidden', 'G9: родитель получает forbidden');
select as_nobody();
select throws_ok($$select player_group_since('00000000-0000-0000-0000-00000000001f'::uuid, current_date, false)$$, '42501', 'forbidden', 'G9: без входа forbidden');
select as_user(tx(10));
select throws_ok(format($$select player_group_since(%L, %L, true)$$, tx(31), dd(-2)), '22023', 'date after group start', 'G9: дата позже начала группы');
select throws_ok(format($$select player_group_since(%L, date '1970-01-01', true)$$, tx(31)), '22023', 'date before previous group start', 'G9: дата не позже начала предыдущей группы');
select throws_ok(format($$select player_group_since(%L, %L, true)$$, tx(33), dd(-20)), '22023', 'no previous group', 'G9: у игрока нет предыдущей группы');
select throws_ok($$select player_group_since('00000000-0000-0000-0000-0000000000ff'::uuid, current_date, true)$$, 'P0002', 'player not found', 'G9: игрока нет');
reset role;
select is((select valid_from from player_group_history where player_id = tx(31) and valid_to is null), dd(-5), 'G9: после ошибок история не изменилась');

-- G2-G5 применение для K
select as_user(tx(10));
select is((select player_group_since(tx(31), dd(-20), true) ->> 'changed')::int, 2, 'G3: пересоздано две строки индивидуальных занятий');
reset role;
select is((select valid_to from player_group_history where player_id = tx(31) and group_id = tx(2)), dd(-20), 'G2: у предыдущего интервала valid_to = новая дата');
select is((select valid_from from player_group_history where player_id = tx(31) and valid_to is null), dd(-20), 'G2: у текущего valid_from = новая дата');
select is(points_group_at(tx(31), dd(-12)), tx(3), 'G2: на день внутри периода группа новая');
select is(points_group_at(tx(31), dd(-25)), tx(2), 'G2: до новой даты группа прежняя');
select is((select count(*)::int from points_ledger where player_id = tx(31) and status = 'active' and source_type = 'individual' and group_id = tx(3)), 3, 'G3: все три действующих индивидуальных начисления в новой группе');
select is((select count(*)::int from points_ledger where player_id = tx(31) and status = 'superseded' and source_type = 'individual'), 2, 'G3: две прежние строки закрыты (superseded)');
select is((select group_id from points_ledger where player_id = tx(31) and source_type = 'manual'), tx(2), 'G5: ручное начисление осталось со старой группой');
select is((select sum(points)::int from points_ledger where player_id = tx(31) and status = 'active'), (select pts from tot where player_id = tx(31)), 'G4: сумма баллов K не изменилась');

-- G7 повтор
select as_user(tx(10));
select is((select player_group_since(tx(31), dd(-20), true) ->> 'changed')::int, 0, 'G7: повтор с той же датой ничего не меняет');
reset role;
select is((select count(*)::int from notifications), (select n from q0), 'G8: уведомления родителям не созданы');

-- G6 случай без ручных начислений: после переноса одна группа
select as_user(tx(10));
select ok((player_group_since(tx(32), dd(-20), true) ->> 'changed')::int = 2, 'G6: перенос для M применён');
reset role;
select is((select count(distinct group_id)::int from points_ledger where player_id = tx(32) and status = 'active'), 1, 'G6: у M после переноса начисления в одной группе');
select is((select (array_agg(distinct group_id))[1] from points_ledger where player_id = tx(32) and status = 'active'), tx(3), 'G6: это новая группа');
select is((select sum(points)::int from points_ledger where player_id = tx(32) and status = 'active'), (select pts from tot where player_id = tx(32)), 'G4: сумма баллов M не изменилась');

-- G10 права
select ok(has_function_privilege('authenticated', 'player_group_since(uuid,date,boolean)', 'execute'), 'G10: authenticated вызывает');
select ok(not has_function_privilege('anon', 'player_group_since(uuid,date,boolean)', 'execute') and not has_function_privilege('public', 'player_group_since(uuid,date,boolean)', 'execute'), 'G10: anon и public не вызывают');

select * from finish();
rollback;
