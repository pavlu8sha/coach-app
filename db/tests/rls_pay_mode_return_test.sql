-- pgTAP: возврат на абонемент с датой, период «за визит» (миграция 0229). Условия: docs/PAY_MODE_RETURN_AND_NEXT_MONTH_ACCEPTANCE.md, часть A. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(28);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб А');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000a1', 9901, 'Админ А', true, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000c1', 9902, 'Тренер', false, '00000000-0000-0000-0000-00000000c001');
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-B', 'Чиовани'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U10-A', 'Чиовани');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Лев', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Матвей', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Саша', 'active');
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-11-20 15:00+04', 'training', 'ATT|2026-11-20', 'regular'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000e1', '2026-12-03 15:00+04', 'training', 'ATT|2026-12-03', 'regular'),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000000e2', '2026-11-21 15:00+04', 'training', 'ATT|2026-11-21', 'regular'),
  ('00000000-0000-0000-0000-0000000005a4', '00000000-0000-0000-0000-0000000000e2', '2026-10-25 15:00+04', 'training', 'ATT|2026-10-25', 'regular');
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
grant execute on function as_user(uuid) to authenticated;

-- Ч1: колонка и ограничения
select has_column('public', 'players', 'pay_mode_until', 'Ч1: есть players.pay_mode_until');

-- Ч2: перевод «за визит» с 01.11, отметка на 20.11 даёт визит
select as_user('00000000-0000-0000-0000-0000000000a1');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'per_visit', '2026-11-01');
reset role;
insert into attendance (session_id, player_id, status) values ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 'present');
select is((select count(*) from own_visits where player_id = '00000000-0000-0000-0000-00000000d001')::int, 1, 'Ч2: визит за 20.11 создан, пока игрок «за визит»');

-- Ч3: возврат с 01.12: период сохранён, режим subscription, до — дата возврата
select as_user('00000000-0000-0000-0000-0000000000a1');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'subscription', '2026-12-01');
reset role;
select is((select pay_mode || '|' || pay_mode_from || '|' || pay_mode_until from players where id = '00000000-0000-0000-0000-00000000d001'),
          'subscription|2026-11-01|2026-12-01', 'Ч3: возврат с 01.12 хранит период 01.11 — 01.12');
select is((select after->>'pay_mode_until' from audit_log where action = 'player_pay_mode' and entity_id = '00000000-0000-0000-0000-00000000d001' order by id desc limit 1),
          '2026-12-01', 'Ч3: в журнале видна дата возврата');

-- Ч4: месяцы
select ok(player_per_visit_month('00000000-0000-0000-0000-00000000d001', '2026-11-01'), 'Ч4: ноябрь — «за визит»');
select ok(not player_per_visit_month('00000000-0000-0000-0000-00000000d001', '2026-12-01'), 'Ч4: декабрь (месяц возврата) — абонементный');
select ok(not player_per_visit_month('00000000-0000-0000-0000-00000000d001', '2026-10-01'), 'Ч4: октябрь до перевода — абонементный');

-- Ч5: после возврата новые визиты за декабрь не создаются, старый визит остаётся
insert into attendance (session_id, player_id, status) values ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d001', 'present');
select is((select count(*) from own_visits where player_id = '00000000-0000-0000-0000-00000000d001')::int, 1, 'Ч5: декабрьская отметка визита не дала, ноябрьский визит остался');

-- Ч6: повторный вызов с теми же значениями ничего не меняет
select as_user('00000000-0000-0000-0000-0000000000a1');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'subscription', '2026-12-01');
reset role;
select is((select count(*) from audit_log where action = 'player_pay_mode' and entity_id = '00000000-0000-0000-0000-00000000d001')::int, 2, 'Ч6: повтор не пишет второй журнал');

-- Ч7: дата по умолчанию — первое число следующего месяца
select as_user('00000000-0000-0000-0000-0000000000a1');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d002', 'per_visit', '2026-11-01');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d002', 'subscription');
reset role;
select is((select pay_mode_until from players where id = '00000000-0000-0000-0000-00000000d002'),
          (date_trunc('month', tbilisi_day(now())) + interval '1 month')::date, 'Ч7: без даты возврат с 1-го числа следующего месяца');

-- Ч8: дата возврата не позже начала стирает период
select as_user('00000000-0000-0000-0000-0000000000a1');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d003', 'per_visit', '2026-11-10');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d003', 'subscription', '2026-11-05');
reset role;
select is((select pay_mode || '|' || coalesce(pay_mode_from::text, '-') || '|' || coalesce(pay_mode_until::text, '-') from players where id = '00000000-0000-0000-0000-00000000d003'),
          'subscription|-|-', 'Ч8: возврат до начала периода стирает период');
select ok(not player_per_visit_month('00000000-0000-0000-0000-00000000d003', '2026-11-01'), 'Ч8: ноябрь абонементный');

-- Ч9: запланированный возврат в будущем: пока что период действует до даты (месяц возврата уже абонементный)
update players set pay_mode = 'per_visit', pay_mode_from = '2026-11-01', pay_mode_until = null where id = '00000000-0000-0000-0000-00000000d003';
select as_user('00000000-0000-0000-0000-0000000000a1');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d003', 'subscription', '2027-03-01');
reset role;
select ok(player_per_visit_month('00000000-0000-0000-0000-00000000d003', '2027-02-01') and not player_per_visit_month('00000000-0000-0000-0000-00000000d003', '2027-03-01'), 'Ч9: будущая дата возврата: февраль «за визит», март абонемент');

-- Ч10: ограничение таблицы
select throws_ok($$update players set pay_mode = 'per_visit', pay_mode_until = '2027-01-01' where id = '00000000-0000-0000-0000-00000000d003'$$, '23514', null, 'Ч10: per_visit с датой возврата запрещён');
select throws_ok($$update players set pay_mode_until = pay_mode_from where id = '00000000-0000-0000-0000-00000000d003'$$, '23514', null, 'Ч10: дата возврата не позже начала запрещена');

-- Ч11: доп. посещение чужой группы: за ноябрь «за визит» 20, до начала периода 15
update players set pay_mode = 'subscription', pay_mode_from = '2026-11-01', pay_mode_until = '2026-12-01' where id = '00000000-0000-0000-0000-00000000d001';
select as_user('00000000-0000-0000-0000-0000000000a1');
select session_guest_add('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-00000000d001');
select session_guest_add('00000000-0000-0000-0000-0000000005a4', '00000000-0000-0000-0000-00000000d001');
reset role;
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a3' and player_id = '00000000-0000-0000-0000-00000000d001'), own_visit_fee('00000000-0000-0000-0000-00000000c001'), 'Ч11: гость в период «за визит» платит own_visit.fee');
select is((select amount from session_guests where session_id = '00000000-0000-0000-0000-0000000005a4' and player_id = '00000000-0000-0000-0000-00000000d001'), guest_visit_fee('00000000-0000-0000-0000-00000000c001'), 'Ч11: гость до начала периода платит visit.fee');

-- Ч12: итог за месяц видит гостевое посещение только в периоде
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select (player_visit_month('00000000-0000-0000-0000-00000000d001', '2026-11-01')->>'guest_visits')::int), 1, 'Ч12: ноябрь: одно доп. посещение');
reset role;

-- Ч13: права
select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'subscription', '2026-12-01')$$, '42501', 'forbidden', 'Ч13: тренер не меняет тип оплаты');
reset role;
select ok(has_function_privilege('authenticated', 'public.player_set_pay_mode(uuid, text, date)', 'execute') and not has_function_privilege('anon', 'public.player_set_pay_mode(uuid, text, date)', 'execute'), 'Ч13: player_set_pay_mode — authenticated, не anon');
select ok(not has_function_privilege('authenticated', 'public.player_per_visit_month(uuid, date)', 'execute') and not has_function_privilege('anon', 'public.player_per_visit_month(uuid, date)', 'execute'), 'Ч13: player_per_visit_month закрыта для ролей');
select ok(not has_function_privilege('authenticated', 'public.player_per_visit_day(uuid, date)', 'execute') and not has_function_privilege('anon', 'public.player_per_visit_day(uuid, date)', 'execute'), 'Ч13: player_per_visit_day закрыта для ролей');

-- Ч14: безопасная конфигурация (стандарт ревью, search_path = public, pg_temp, security definer) у всех изменённых функций
select is((select count(*)::int from pg_proc p where p.oid in (to_regprocedure('public.player_per_visit_month(uuid,date)'), to_regprocedure('public.player_per_visit_day(uuid,date)'), to_regprocedure('public.own_visits_backfill(uuid)'), to_regprocedure('public.attendance_own_visit_sync()'), to_regprocedure('public.player_set_pay_mode(uuid,text,date)'), to_regprocedure('public.session_guest_add(uuid,uuid)'), to_regprocedure('public.player_visit_month(uuid,date)'))
  and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']), 7, 'Ч14: 7 функций 0229: security definer и search_path = public, pg_temp');

-- Ч15: подмена таблицы через pg_temp не меняет результат: временная players говорит, что Дима «за визит», настоящая — нет
insert into public.players (id, club_id, group_id, full_name, status) values ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Дима', 'active');
create temp table players (id uuid, pay_mode text, pay_mode_from date, pay_mode_until date, club_id uuid, group_id uuid, status text);
insert into pg_temp.players values ('00000000-0000-0000-0000-00000000d004', 'per_visit', '2026-11-01', null, '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'active');
select ok(not player_per_visit_month('00000000-0000-0000-0000-00000000d004', '2026-11-01'), 'Ч15: подмена players через pg_temp не влияет на player_per_visit_month');
select ok(not player_per_visit_day('00000000-0000-0000-0000-00000000d004', '2026-11-20'), 'Ч15: подмена players через pg_temp не влияет на player_per_visit_day');
drop table pg_temp.players;

-- Ч16: откат 0229 возвращает прежние тела, но не небезопасную конфигурацию (стандарт ревью): search_path = public, pg_temp остаётся
\i db/ops/rollback-0229-pay-mode-until.sql
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'pay_mode_until'), 'Ч16: после отката колонки pay_mode_until нет');
select is((select count(*)::int from pg_proc p where p.oid in (to_regprocedure('public.player_per_visit_month(uuid,date)'), to_regprocedure('public.own_visits_backfill(uuid)'), to_regprocedure('public.attendance_own_visit_sync()'), to_regprocedure('public.player_set_pay_mode(uuid,text,date)'), to_regprocedure('public.session_guest_add(uuid,uuid)'), to_regprocedure('public.player_visit_month(uuid,date)'))
  and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']), 6, 'Ч16: после отката 6 функций с security definer и search_path = public, pg_temp');
select ok(exists (select 1 from pg_constraint where conname = 'players_pay_mode_from_check') and to_regprocedure('public.player_per_visit_day(uuid,date)') is null, 'Ч16: после отката прежнее ограничение, player_per_visit_day удалена');

select * from finish();
rollback;
