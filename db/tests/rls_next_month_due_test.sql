-- pgTAP: следующий месяц с N-го числа считается долгом, не оплатой «вперёд» (миграция 0230). Условия: docs/PAY_MODE_RETURN_AND_NEXT_MONTH_ACCEPTANCE.md, часть B. Фикстуры вымышленные.
-- Дата подменяется третьим аргументом debt_month_limit (прямые проверки); сквозные проверки не зависят от сегодняшнего числа (N = 1 всегда включает следующий месяц; N = 31 сверяется с фактическим днём).
begin;
create extension if not exists pgtap;
select plan(16);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin, club_id) values
  ('00000000-0000-0000-0000-0000000000a1', 9901, 'Админ', true, '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-0000000000b1', 9903, 'Родитель', false, null);
insert into groups (id, club_id, name, location) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-B', 'Чиовани');
insert into players (id, club_id, group_id, full_name, status, pay_mode, pay_mode_from) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня (абонемент, не платила)', 'active', 'subscription', null),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря (за визит)', 'active', 'per_visit', '2026-09-01'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вера (скидка)', 'active', 'subscription', null),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Гоша (оплатил)', 'active', 'subscription', null);
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());
insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 165, '2026-09-01');
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true');
-- строки текущего и следующего месяцев: Вера со скидкой на следующий, Гоша оплатил следующий
insert into subscriptions (player_id, group_id, month, amount_due, discount, closed_kind, closed_reason) values
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e1', (date_trunc('month', tbilisi_day(now())) + interval '1 month')::date, 165, true, 'discount', 'тест');
insert into payments (player_id, amount, paid_on, method, for_month) values
  ('00000000-0000-0000-0000-00000000d004', 165, tbilisi_day(now()), 'Наличные', (date_trunc('month', tbilisi_day(now())) + interval '1 month')::date);
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
grant execute on function as_user(uuid) to authenticated;

-- Б1: порог по умолчанию 22 (настройки нет)
select is(debt_month_limit('00000000-0000-0000-0000-00000000c001', true, date '2026-11-21'), date '2026-11-01', 'Б1: 21-го следующий месяц ещё «вперёд»');
select is(debt_month_limit('00000000-0000-0000-0000-00000000c001', true, date '2026-11-22'), date '2026-12-01', 'Б1: с 22-го следующий месяц — долг');
select is(debt_month_limit('00000000-0000-0000-0000-00000000c001', true, date '2026-12-21'), date '2026-12-01', 'Б1: 21 декабря январь ещё не долг');
select is(debt_month_limit('00000000-0000-0000-0000-00000000c001', true, date '2026-12-22'), date '2027-01-01', 'Б1: 22 декабря январь — долг (конец года)');
select is(debt_month_limit('00000000-0000-0000-0000-00000000c001', true, date '2026-11-30'), date '2026-12-01', 'Б1: 30 ноября декабрь — долг');
-- Б1: своя настройка и короткий месяц
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'payments.nextMonthDay', '25');
select is(debt_month_limit('00000000-0000-0000-0000-00000000c001', true, date '2026-11-24'), date '2026-11-01', 'Б1: настройка 25: 24-го ещё нет');
select is(debt_month_limit('00000000-0000-0000-0000-00000000c001', true, date '2026-11-25'), date '2026-12-01', 'Б1: настройка 25: 25-го уже да');
update club_settings set value = '31' where club_id = '00000000-0000-0000-0000-00000000c001' and key = 'payments.nextMonthDay';
select is(debt_month_limit('00000000-0000-0000-0000-00000000c001', true, date '2026-11-30'), date '2026-12-01', 'Б1: настройка 31: в месяце из 30 дней порог — последний день');
-- Б1: недопустимое значение
update club_settings set value = 'abc' where club_id = '00000000-0000-0000-0000-00000000c001' and key = 'payments.nextMonthDay';
select throws_ok($$select debt_month_limit('00000000-0000-0000-0000-00000000c001', true, date '2026-11-30')$$, '22023', null, 'Б1: недопустимая настройка — явная ошибка');
select is(debt_month_limit('00000000-0000-0000-0000-00000000c001', false, date '2026-11-30'), date '2026-11-01', 'Б1: для кабинета родителя недопустимая настройка не ломает экран: следующий месяц не показывается');

-- Б2: «Должники» следующего месяца (N = 1: следующий месяц всегда включён)
update club_settings set value = '1' where club_id = '00000000-0000-0000-0000-00000000c001' and key = 'payments.nextMonthDay';
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from debtors((date_trunc('month', tbilisi_day(now())) + interval '1 month')::date) where player_id = '00000000-0000-0000-0000-00000000d001' and debt = 165), 1, 'Б2: игрок без оплаты следующего месяца — должник');
select is((select count(*)::int from debtors((date_trunc('month', tbilisi_day(now())) + interval '1 month')::date) where player_id in ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000d004')), 0, 'Б4: за визит, со скидкой и оплативший в должниках не числятся');
select throws_ok($$select * from debtors((date_trunc('month', tbilisi_day(now())) + interval '2 month')::date)$$, null, 'month out of range', 'Б2: через два месяца — вне диапазона');
reset role;

-- Б3: кабинет родителя
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d001' and month = (date_trunc('month', tbilisi_day(now())) + interval '1 month')::date and debt = 165), 1, 'Б3: с порогом родитель видит долг за следующий месяц');
reset role;
update club_settings set value = '31' where club_id = '00000000-0000-0000-0000-00000000c001' and key = 'payments.nextMonthDay';
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d001' and month > date_trunc('month', tbilisi_day(now()))::date),
          case when extract(day from tbilisi_day(now())) >= least(31, extract(day from (date_trunc('month', tbilisi_day(now())) + interval '1 month - 1 day'))) then 1 else 0 end,
          'Б3: до порога следующий месяц не в долге (сверка с фактическим днём)');
reset role;

-- Права
select ok(not has_function_privilege('authenticated', 'public.debt_month_limit(uuid, boolean, date)', 'execute') and not has_function_privilege('anon', 'public.debt_month_limit(uuid, boolean, date)', 'execute'), 'права: debt_month_limit закрыта для ролей');

select * from finish();
rollback;
