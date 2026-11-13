-- #630: отмена дополнительной тренировки клубом после отметки посещения (вариант A, условия: docs/acceptance/extra-cancel-attended-630-2026-11-13.md).
-- Данные вымышленные; тренировки без времени (запись открыта).
begin;
create extension if not exists pgtap;
select plan(37);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9941, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9942, 'Тренер U9', false),
  ('00000000-0000-0000-0000-0000000000b1', 9943, 'Родитель 1 (Аня U9 и Гриша U11)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9944, 'Родитель 2 (Боря U9)', false),
  ('00000000-0000-0000-0000-0000000000b3', 9945, 'Родитель 3 (Дима U11)', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Гриша', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Дима', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now()),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b3', 'test', now());
insert into club_settings (club_id, key, value, scope) values
  ('00000000-0000-0000-0000-00000000c001', 'booking.notify', 'on', ''),
  ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true', '');
insert into points_rule_versions (id, club_id, effective_from, params) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c001', '2020-01-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
create or replace function sx(k text) returns uuid language sql stable as $$ select id from ids where ids.k = sx.k $$;
grant execute on function sx(text) to authenticated;
-- снимок состояния: активные баллы | записи | журнал отмен по сессии | сумма оплат
create or replace function snap(s uuid) returns text language sql as $$
  select (select count(*) from points_ledger where source_id = s and status = 'active') || '|' ||
         (select count(*) from extra_bookings where session_id = s) || '|' ||
         (select count(*) from booking_cancellations where session_id = s) || '|' ||
         (select coalesce(sum(amount), 0)::int from service_payments) || '|' ||
         (select count(*) from extra_activity where session_id = s) || '|' ||
         (select count(*) from notifications where kind = 'booking_cancelled') || '|' ||
         (select (cancelled_at is not null)::text from extra_sessions where id = s) $$;
grant execute on function snap(uuid) to authenticated;
-- пять тренировок на разные даты: s1 до отметок, s2 отметка «был», s3 «был» плюс «не был», s4 «не был», s5 для прав
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 's' || n, extra_create_session((now() at time zone 'Asia/Tbilisi')::date + (n - 1), 30, 'Зал ' || n, array['00000000-0000-0000-0000-0000000000e1']::uuid[], array['00000000-0000-0000-0000-00000000d002']::uuid[]) from generate_series(1, 5) n;
select as_user('00000000-0000-0000-0000-0000000000b1');
select booking_signup('extra', sx('s' || n), '00000000-0000-0000-0000-00000000d001') from generate_series(1, 5) n;
select booking_signup('extra', sx('s' || n), '00000000-0000-0000-0000-00000000d002') from generate_series(1, 5) n;
select as_user('00000000-0000-0000-0000-0000000000b2');
select booking_signup('extra', sx('s' || n), '00000000-0000-0000-0000-00000000d003') from generate_series(1, 5) n;
-- оплаты: Аня оплатила все пять; Гриша оплатил s3 и s4; Боря не платил
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_set_paid(sx('s' || n), '00000000-0000-0000-0000-00000000d001', true, 'Наличные', 30, null) from generate_series(1, 5) n;
select extra_set_paid(sx('s3'), '00000000-0000-0000-0000-00000000d002', true, 'Наличные', 30, null);
select extra_set_paid(sx('s4'), '00000000-0000-0000-0000-00000000d002', true, 'Наличные', 30, null);
reset role;
select is((select count(*)::int from service_payments), 7, 'исходные оплаты: 7 строк (5 Аня, 2 Гриша)');

-- ===== 1. Отмена до отметок: прежнее поведение =====
delete from notifications;
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_cancel_session(sx('s1'), 'Дождь');
reset role;
select is((select string_agg(pl.full_name || ':' || c.status || ':' || c.amount::int, ',' order by pl.full_name) from booking_cancellations c join players pl on pl.id = c.player_id where c.session_id = sx('s1')),
  'Аня:awaiting:30,Боря:cancelled:0,Гриша:cancelled:0', '1: без отметок оплаченный ждёт решения, неоплаченные закрыты');
select is((select count(*)::int from extra_bookings where session_id = sx('s1')), 0, '1: записи удалены');
select is((select count(distinct user_id)::int from notifications where kind = 'booking_cancelled'), 2, '1: уведомление получили две семьи');

-- ===== 2. attended = true: отказ без побочных эффектов (оплаченный Аня, неоплаченный Боря) =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_set_attended(sx('s2'), '00000000-0000-0000-0000-00000000d001', true);
reset role;
create temp table before2 as select snap(sx('s2')) v;
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select extra_cancel_session(sx('s2'), 'Дождь')$$, '22023', 'attendance marked', '2: оплаченный с отметкой «был»: отказ');
select extra_set_attended(sx('s2'), '00000000-0000-0000-0000-00000000d003', true);
select extra_set_attended(sx('s2'), '00000000-0000-0000-0000-00000000d001', null);
select throws_ok($$select extra_cancel_session(sx('s2'), 'Дождь')$$, '22023', 'attendance marked', '2: неоплаченный с отметкой «был»: отказ');
reset role;
select is((select count(*)::int from extra_bookings where session_id = sx('s2')), 3, '2: записи на месте');
select is((select count(*)::int from booking_cancellations where session_id = sx('s2')) + (select count(*)::int from extra_activity where session_id = sx('s2') and action = 'cancelled'), 0, '2: журнала отмен и записи об отмене нет');
select is((select cancelled_at is null from extra_sessions where id = sx('s2')), true, '2: сессия не отменена');
select is((select count(*)::int from notifications where kind = 'booking_cancelled' and text like '%' || (select place from extra_sessions where id = sx('s2')) || '%'), 0, '2: уведомлений об отмене нет');

-- ===== 3. Снять отметку и отменить: сторно с аудитом, оплаченная ждёт решения =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_set_attended(sx('s2'), '00000000-0000-0000-0000-00000000d003', true);
select extra_set_attended(sx('s2'), '00000000-0000-0000-0000-00000000d001', true);
reset role;
select is((select count(*)::int from points_ledger where source_id = sx('s2') and status = 'active'), 2, '3: до снятия начислены баллы двоим');
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_set_attended(sx('s2'), '00000000-0000-0000-0000-00000000d003', null);
select extra_set_attended(sx('s2'), '00000000-0000-0000-0000-00000000d001', null);
select extra_cancel_session(sx('s2'), 'Дождь');
reset role;
select is((select count(*)::int from points_ledger where source_id = sx('s2') and status = 'active'), 0, '3: активных баллов нет');
select is((select count(*)::int from points_ledger_audit a join points_ledger l on l.id = a.ledger_id where l.source_id = sx('s2') and a.action = 'cancel'), 3, '3: сторно записано в аудит: по строке на каждое снятие отметки (Аня в п. 2, затем Аня и Боря)');
select is((select string_agg(pl.full_name || ':' || c.status || ':' || c.amount::int, ',' order by pl.full_name) from booking_cancellations c join players pl on pl.id = c.player_id where c.session_id = sx('s2')),
  'Аня:awaiting:30,Боря:cancelled:0,Гриша:cancelled:0', '3: оплаченная Аня ждёт решения, неоплаченные закрыты');

-- ===== 4. attended = false, оплаченный и неоплаченный =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_set_attended(sx('s3'), '00000000-0000-0000-0000-00000000d002', false);  -- Гриша оплатил
select extra_set_attended(sx('s3'), '00000000-0000-0000-0000-00000000d003', false);  -- Боря не платил
select extra_cancel_session(sx('s3'), 'Дождь');
reset role;
select is((select string_agg(pl.full_name || ':' || c.status || ':' || c.amount::int, ',' order by pl.full_name) from booking_cancellations c join players pl on pl.id = c.player_id where c.session_id = sx('s3')),
  'Аня:awaiting:30,Боря:cancelled:0,Гриша:awaiting:30', '4: «не был»: оплаченный awaiting, неоплаченный cancelled');
select is((select count(*)::int from extra_bookings where session_id = sx('s3')), 0, '4: активных записей не осталось');

-- ===== 5. Повторная отмена: без новых строк, аудита и уведомлений =====
create temp table before5 as select snap(sx('s3')) v, (select count(*) from points_ledger_audit) a;
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select extra_cancel_session(sx('s3'), 'Ещё раз')$$, '55000', 'session cancelled', '5: повторная отмена отклонена');
reset role;
select is(snap(sx('s3')), (select v from before5), '5: после повторной отмены состояние то же (баллы, записи, журнал, оплаты, действия, уведомления)');
select is((select count(*) from points_ledger_audit), (select a from before5), '5: аудит баллов не вырос');

-- ===== 6. Повторный reconcile и повторное снятие отметки: без повторного сторно =====
create temp table before6 as select (select count(*) from points_ledger) l, (select count(*) from points_ledger_audit) a;
select points_reconcile_extra(sx('s2'));
select points_reconcile_extra(sx('s2'));
select is((select count(*) from points_ledger) || '/' || (select count(*) from points_ledger_audit), (select l || '/' || a from before6), '6: повторный reconcile ничего не меняет');
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select extra_set_attended(sx('s2'), '00000000-0000-0000-0000-00000000d001', null)$$, '55000', 'session cancelled', '6: после отмены отметку менять нельзя');
reset role;
select is((select count(*) from points_ledger_audit), (select a from before6), '6: аудит не вырос');

-- ===== 7. Серия не меняется =====
select is((select count(*)::int from points_ledger where source_type = 'series_bonus'), 0, '7: бонусов серии нет');
select is((select count(*)::int from points_series_scan('00000000-0000-0000-0000-00000000d001')), 0, '7: доп. тренировки в серию не входят');

-- ===== 8. Права и изоляция =====
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select extra_cancel_session(sx('s4'), 'x')$$, '42501', 'forbidden', '8: тренер отменить не может');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select extra_cancel_session(sx('s4'), 'x')$$, '42501', 'forbidden', '8: родитель отменить не может');
select is((select count(*)::int from booking_cancellations), 0, '8: родитель журнал отмен не видит');
reset role;
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-0000000000b3'), 0, '8: чужая семья уведомлений не получила');
select is((select count(*)::int from notifications n where n.player_ids is not null and exists (select 1 from unnest(n.player_ids) x(pid)
            where not exists (select 1 from player_guardians g where g.user_id = n.user_id and g.player_id = x.pid))), 0, '8: уведомления ушли только опекунам');
select is(has_function_privilege('anon', 'extra_cancel_session(uuid,text)', 'execute') or has_function_privilege('public', 'extra_cancel_session(uuid,text)', 'execute'), false, '8: anon и public функцию не вызывают');
select is(has_function_privilege('authenticated', 'extra_cancel_session(uuid,text)', 'execute'), true, '8: authenticated вызывает');

-- ===== 9. Сверка баллов и оплат =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select (r->>'changes')::int || '/' || jsonb_array_length(r->'exceptions') from (select points_consistency(false) r) x), '0/0', '9: points_consistency: 0 изменений, 0 исключений');
reset role;
select is((select count(*)::int from service_payments), 7, '9: платежи не менялись');
select is((select sum(amount)::int from service_payments), 210, '9: сумма service_payments прежняя (7 по 30)');

-- ===== 10. Страж: отменённой сессии с attended = true нет после допустимых цепочек =====
select is((select count(*)::int from extra_bookings b join extra_sessions s on s.id = b.session_id where s.cancelled_at is not null and b.attended is true), 0, '10: после цепочки нет отменённой сессии с «был»');
select as_user('00000000-0000-0000-0000-0000000000a1');
select extra_set_attended(sx('s5'), '00000000-0000-0000-0000-00000000d001', true);
select throws_ok($$select extra_cancel_session(sx('s5'), 'x')$$, '22023', 'attendance marked', '10: отмена с «был» по-прежнему отказ');
reset role;
select is((select count(*)::int from extra_bookings b join extra_sessions s on s.id = b.session_id where s.cancelled_at is not null and b.attended is true), 0, '10: страж после отказа');

select * from finish();
rollback;
