-- pgTAP: автосоздание абонементов на месяц и счётчик «без строки» (0128).
begin;
create extension if not exists pgtap;
select plan(8);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8201, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8202, 'Тренер', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'Индивидуальные / Вратарские');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Первый', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Второй', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Индивидуальный', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ушёл', 'inactive');
insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 165, '2026-09-01') on conflict do nothing;
-- у Первого строка уже есть, и она не должна измениться
insert into subscriptions (player_id, group_id, month, amount_due, discount) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', date_trunc('month', current_date)::date, 100, true);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select subscription_month_missing(date_trunc('month', current_date)::date)$$, '42501', 'forbidden', 'тренер не видит счётчик');
select throws_ok($$select subscription_month_auto(null)$$, '42501', null, 'авторизованный пользователь не вызывает внутреннюю функцию автосоздания');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is(subscription_month_missing(date_trunc('month', current_date)::date), 1, 'без строки один игрок: Второй (индивидуальный и ушедший не считаются, у Первого строка есть)');

reset role;
select is(subscription_month_auto(null), 1, 'cron создал строку только Второму');
select is(subscription_month_auto(null), 0, 'повторный запуск ничего не создаёт: дублей нет');
select is((select amount_due from subscriptions where player_id = '00000000-0000-0000-0000-00000000d002' and month = date_trunc('month', current_date)::date), 165::numeric, 'сумма берётся из цены');
select is((select discount from subscriptions where player_id = '00000000-0000-0000-0000-00000000d001' and month = date_trunc('month', current_date)::date), true, 'существующая строка и её скидка не изменились');
select throws_ok($$select subscription_month_auto('2026-08-01')$$, '22023', 'month out of range', 'месяц раньше сезона нельзя');

select * from finish();
rollback;
