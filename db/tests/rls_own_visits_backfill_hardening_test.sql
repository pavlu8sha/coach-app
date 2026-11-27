-- pgTAP: границы дозаполнения визитов за плату (миграция 0228, Issue #726). Условия: docs/PAY_PER_VISIT_BACKFILL_HARDENING_ACCEPTANCE.md. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(19);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб А'), ('00000000-0000-0000-0000-00000000c002', 'Клуб Б');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000a1', 9901, 'Админ А', true, '00000000-0000-0000-0000-00000000c001');
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-B', 'Чиовани'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'Индивидуальные / вратарские', 'Чиовани'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c002', 'U9-Б2', 'Другой');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d00b', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000e3', 'Игрок клуба Б', 'active');
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-11-02 15:00+04', 'training', 'ATT|2026-11-02', 'regular'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000e1', '2026-11-03 15:00+04', 'match', 'ATT|2026-11-03', 'regular'),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000000e2', '2026-11-04 15:00+04', 'training', 'ATT|2026-11-04', 'regular'),
  ('00000000-0000-0000-0000-0000000005a4', '00000000-0000-0000-0000-0000000000e3', '2026-11-05 15:00+04', 'training', 'ATT|2026-11-05', 'regular'),
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000000e3', '2026-11-02 15:00+04', 'training', 'ATT|2026-11-02', 'regular');
insert into attendance (session_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a4', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-00000000d00b', 'present');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table snap (k text primary key, v text);
grant all on snap to authenticated;
insert into snap select 'payments', (select count(*) from payments)::text;
insert into snap select 'subs', (select count(*) from subscriptions)::text;

-- У1 + У3: за занятия клуба Б, матч и служебную группу визитов нет; за обычную тренировку своей группы один
select as_user('00000000-0000-0000-0000-0000000000a1');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'per_visit', '2026-11-01');
reset role;
select is((select string_agg(session_id::text, ',' order by session_id) from own_visits where player_id = '00000000-0000-0000-0000-00000000d001'),
          '00000000-0000-0000-0000-0000000005a1', 'У1/У3: визит только за обычную тренировку своей группы клуба');
select is((select count(*) from own_visits where session_id = '00000000-0000-0000-0000-0000000005a2')::int, 0, 'У1: занятие kind=match визита не дало');
select is((select count(*) from own_visits where session_id = '00000000-0000-0000-0000-0000000005a3')::int, 0, 'У1: служебная группа «Индивидуальные / вратарские» визита не дала');
select is((select count(*) from own_visits where session_id = '00000000-0000-0000-0000-0000000005a4')::int, 0, 'У3: занятие группы другого клуба визита не дало');

-- У1: триггер той же границы: новые отметки на не-training и служебной группе визита не дают
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a5', '00000000-0000-0000-0000-0000000000e2', '2026-11-06 15:00+04', 'training', 'ATT|2026-11-06', 'regular'),
  ('00000000-0000-0000-0000-0000000005a6', '00000000-0000-0000-0000-0000000000e1', '2026-11-07 15:00+04', 'match', 'ATT|2026-11-07', 'regular'),
  ('00000000-0000-0000-0000-0000000005a7', '00000000-0000-0000-0000-0000000000e1', '2026-11-08 15:00+04', 'training', 'ATT|2026-11-08', 'regular');
insert into attendance (session_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000005a5', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a6', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a7', '00000000-0000-0000-0000-00000000d001', 'present');
select is((select string_agg(tbilisi_day(s.starts_at)::text, ',' order by s.starts_at) from own_visits v join sessions s on s.id = v.session_id where v.player_id = '00000000-0000-0000-0000-00000000d001'),
          '2026-11-02,2026-11-08', 'У1: триггер тоже создаёт визит только за обычную тренировку');

-- У5: старый неоплаченный визит за занятие не-training (остаток 0200/0213) снимается вместе с отметкой «Был»; оплаченный не снимается
insert into own_visits (session_id, player_id, amount) values ('00000000-0000-0000-0000-0000000005a6', '00000000-0000-0000-0000-00000000d001', 20);
update attendance set status = 'absent' where session_id = '00000000-0000-0000-0000-0000000005a6' and player_id = '00000000-0000-0000-0000-00000000d001';
select is((select count(*) from own_visits where session_id = '00000000-0000-0000-0000-0000000005a6')::int, 0, 'У5: неоплаченный визит за не-training удалён при «Не был»');
update attendance set status = 'present' where session_id = '00000000-0000-0000-0000-0000000005a6' and player_id = '00000000-0000-0000-0000-00000000d001';
select is((select count(*) from own_visits where session_id = '00000000-0000-0000-0000-0000000005a6')::int, 0, 'У5: новая отметка «Был» за не-training визит не создаёт');
insert into own_visits (session_id, player_id, amount, paid, paid_amount, method) values ('00000000-0000-0000-0000-0000000005a6', '00000000-0000-0000-0000-00000000d001', 20, true, 20, 'Наличные');
select throws_ok($$update attendance set status = 'absent' where session_id = '00000000-0000-0000-0000-0000000005a6' and player_id = '00000000-0000-0000-0000-00000000d001'$$, '22023', 'visit paid', 'У5: оплаченный визит снять отметкой нельзя');
delete from own_visits where session_id = '00000000-0000-0000-0000-0000000005a6';

-- У3: администратор клуба А не может перевести игрока клуба Б
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select player_set_pay_mode('00000000-0000-0000-0000-00000000d00b', 'per_visit', '2026-11-01')$$, '42501', null, 'У3: игрок другого клуба: отказ');
reset role;
select is((select pay_mode from players where id = '00000000-0000-0000-0000-00000000d00b'), 'subscription', 'У3: режим игрока клуба Б не изменился');
select is((select count(*) from own_visits where player_id = '00000000-0000-0000-0000-00000000d00b')::int, 0, 'У3: визитов у игрока клуба Б нет');

-- У2: ошибка дозаполнения откатывает смену режима целиком
update players set pay_mode = 'subscription', pay_mode_from = null where id = '00000000-0000-0000-0000-00000000d001';
delete from own_visits where player_id = '00000000-0000-0000-0000-00000000d001';
create function boom() returns trigger language plpgsql as $$ begin raise exception 'boom' using errcode = 'P0001'; end $$;
create trigger boom before insert on own_visits for each row execute function boom();
insert into snap select 'audit', (select count(*) from audit_log)::text;
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'per_visit', '2026-11-01')$$, 'P0001', 'boom', 'У2: ошибка дозаполнения пробрасывается');
reset role;
select is((select pay_mode || coalesce(pay_mode_from::text, '-') from players where id = '00000000-0000-0000-0000-00000000d001'), 'subscription-', 'У2: режим остался прежним');
select is((select count(*) from own_visits where player_id = '00000000-0000-0000-0000-00000000d001')::int, 0, 'У2: визитов нет');
select is((select count(*) from audit_log)::text, (select v from snap where k = 'audit'), 'У2: audit_log не пополнился');
drop trigger boom on own_visits;

-- У4: деньги абонемента не менялись, права закрыты
select is((select count(*) from payments)::text || '/' || (select count(*) from subscriptions)::text || '/' || (select count(*) from service_payments)::text,
          (select v from snap where k = 'payments') || '/' || (select v from snap where k = 'subs') || '/0', 'У4: payments, subscriptions, service_payments не менялись');
select is(has_function_privilege('authenticated', 'public.own_visits_backfill(uuid)', 'execute') or has_function_privilege('anon', 'public.own_visits_backfill(uuid)', 'execute'), false, 'У4: own_visits_backfill закрыта для authenticated и anon');

-- У6: SECURITY DEFINER с search_path = public, pg_temp (pg_temp последним, ревью #855)
select is((select count(*)::int from pg_proc p where p.oid in (to_regprocedure('public.own_visits_backfill(uuid)'), to_regprocedure('public.attendance_own_visit_sync()'), to_regprocedure('public.player_set_pay_mode(uuid, text, date)')) and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']), 3, 'У6: три функции 0228 с search_path = public, pg_temp');

-- У7: откат 0228 не возвращает search_path = public (ревью #855): функции после отката остаются с public, pg_temp и security definer
\i db/ops/rollback-0228-own-visits-boundaries.sql
select is((select count(*)::int from pg_proc p where p.oid in (to_regprocedure('public.own_visits_backfill(uuid)'), to_regprocedure('public.attendance_own_visit_sync()'), to_regprocedure('public.player_set_pay_mode(uuid, text, date)')) and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']), 3, 'У7: после отката 0228 search_path = public, pg_temp у всех трёх функций');

select * from finish();
rollback;
