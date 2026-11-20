-- pgTAP: дозаполнение визитов за плату при смене режима (миграция 0213). Условия: docs/PAY_PER_VISIT_BACKFILL_ACCEPTANCE.md. Фикстуры вымышленные.
begin;
create extension if not exists pgtap;
select plan(17);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 9902, 'Тренер', false);
insert into groups (id, club_id, name, location) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-B', 'Чиовани');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня (будет за визит)', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря (абонемент)', 'active');
insert into sessions (id, group_id, starts_at, kind, source_key, class) values
  ('00000000-0000-0000-0000-0000000005a0', '00000000-0000-0000-0000-0000000000e1', '2026-10-20 15:00+04', 'training', 'ATT|2026-10-20', 'regular'),
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000e1', '2026-11-02 15:00+04', 'training', 'ATT|2026-11-02', 'regular'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000e1', '2026-11-03 15:00+04', 'training', 'ATT|2026-11-03', 'regular'),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000000e1', '2026-11-04 15:00+04', 'training', 'ATT|2026-11-04', 'regular'),
  ('00000000-0000-0000-0000-0000000005a9', '00000000-0000-0000-0000-0000000000e1', '2099-01-01 15:00+04', 'training', 'ATT|2099-01-01', 'regular');
-- отметки сделаны, пока игрок на абонементе: визитов нет
insert into attendance (session_id, player_id, status) values
  ('00000000-0000-0000-0000-0000000005a0', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d001', 'absent'),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a9', '00000000-0000-0000-0000-00000000d001', 'present'),
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d002', 'present');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table snap (k text primary key, v text);
grant all on snap to authenticated;
insert into snap select 'payments', (select count(*) from payments)::text;
insert into snap select 'subs', (select count(*) from subscriptions)::text;

select is((select count(*) from own_visits)::int, 0, 'У1: до смены режима визитов нет');

select as_user('00000000-0000-0000-0000-0000000000a1');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'per_visit', '2026-11-01');
reset role;
select is((select count(*) from own_visits where player_id = '00000000-0000-0000-0000-00000000d001')::int, 2, 'У1: созданы визиты за 02.11 и 04.11');
select is((select string_agg(tbilisi_day(s.starts_at)::text, ',' order by s.starts_at) from own_visits v join sessions s on s.id = v.session_id where v.player_id = '00000000-0000-0000-0000-00000000d001'), '2026-11-02,2026-11-04', 'У1: именно эти даты');
select is((select count(*) from own_visits where player_id = '00000000-0000-0000-0000-00000000d001' and amount = 20 and not paid)::int, 2, 'У1: сумма 20, не оплачены');
select is((select count(*) from own_visits v where v.session_id = '00000000-0000-0000-0000-0000000005a0')::int, 0, 'У2: занятие раньше даты начала визита не получило');
select is((select count(*) from own_visits v where v.session_id = '00000000-0000-0000-0000-0000000005a2')::int, 0, 'У2: «Не был» визита не получил');
select is((select count(*) from own_visits v where v.session_id = '00000000-0000-0000-0000-0000000005a9')::int, 0, 'У2: будущее занятие визита не получило');
select is((select count(*) from own_visits where player_id = '00000000-0000-0000-0000-00000000d002')::int, 0, 'У5: игрок с абонементом визитов не получил');

-- У3: оплаченный визит не меняется, повторное сохранение того же режима ничего не дублирует
select as_user('00000000-0000-0000-0000-0000000000a1');
select own_visit_set_paid('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d001', true, 'Перевод', null, '2026-11-05');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'per_visit', '2026-11-01');
reset role;
select is((select count(*) from own_visits where player_id = '00000000-0000-0000-0000-00000000d001')::int, 2, 'У3/У4: повтор ничего не дублирует');
select is((select count(*) from own_visits where player_id = '00000000-0000-0000-0000-00000000d001' and paid and paid_amount = 20)::int, 1, 'У3: оплаченный визит остался оплаченным');

-- У1/У4: более ранняя дата добавляет визит за 20.10
select as_user('00000000-0000-0000-0000-0000000000a1');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'per_visit', '2026-10-15');
reset role;
select is((select count(*) from own_visits where player_id = '00000000-0000-0000-0000-00000000d001')::int, 3, 'У4: при более ранней дате добавлен визит за 20.10');

-- У5: возврат на абонемент ничего не создаёт и не удаляет
select as_user('00000000-0000-0000-0000-0000000000a1');
select player_set_pay_mode('00000000-0000-0000-0000-00000000d001', 'subscription', null);
reset role;
select is((select count(*) from own_visits where player_id = '00000000-0000-0000-0000-00000000d001')::int, 3, 'У5: возврат на абонемент визиты не трогает');

-- У6: деньги абонемента не менялись
select is((select count(*) from payments)::text, (select v from snap where k = 'payments'), 'У6: payments не менялись');
select is((select count(*) from subscriptions)::text, (select v from snap where k = 'subs'), 'У6: subscriptions не менялись');
select is((select count(*) from service_payments)::int, 1, 'У6: в service_payments только оплата визита');

-- У7: доступ
select is(has_function_privilege('authenticated', 'public.own_visits_backfill(uuid)', 'execute'), false, 'У7: authenticated не вызывает own_visits_backfill');
select is(has_function_privilege('anon', 'public.own_visits_backfill(uuid)', 'execute'), false, 'У7: anon не вызывает own_visits_backfill');

select * from finish();
rollback;
