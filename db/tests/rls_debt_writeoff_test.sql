-- pgTAP: «Списано» у должников и создание абонементов на месяц (0032).
begin;
create extension if not exists pgtap;
select plan(11);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8101, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8102, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 8103, 'Родитель', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'Индивидуальные / Вратарские');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Должник', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Второй', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Индивидуальный', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Ушёл', 'inactive'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', null, 'Без группы', 'active');
insert into consent_versions (version) values ('v1') on conflict do nothing;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'v1', now());
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true');
insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 165, '2026-09-01') on conflict do nothing;

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select create_subscription_month(date_trunc('month', current_date)::date)$$, '42501', 'forbidden', 'тренер не создаёт абонементы');

select as_user('00000000-0000-0000-0000-0000000000a1');
select is(create_subscription_month(date_trunc('month', current_date)::date), 2, 'созданы строки для двух активных игроков с группой (не индивидуальный, не ушедший, не без группы)');
select is(create_subscription_month(date_trunc('month', current_date)::date), 0, 'повторный вызов ничего не создаёт');
select is((select amount_due from subscriptions where player_id = '00000000-0000-0000-0000-00000000d001' and month = date_trunc('month', current_date)::date), 165::numeric, 'сумма берётся из цены');
select throws_ok($$select create_subscription_month('2026-08-01')$$, '22023', 'month out of range', 'месяц раньше сезона нельзя');
select throws_ok($$select create_subscription_month((date_trunc('month', current_date) + interval '3 month')::date)$$, '22023', 'month out of range', 'через три месяца нельзя');

select is((select count(*)::int from debtors(date_trunc('month', current_date)::date) where full_name = 'Должник'), 1, 'до списания игрок в списке должников');
update subscriptions set written_off = true where player_id = '00000000-0000-0000-0000-00000000d001' and month = date_trunc('month', current_date)::date;
select is((select count(*)::int from debtors(date_trunc('month', current_date)::date) where full_name = 'Должник'), 0, 'после списания игрока в списке нет');

select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select debt from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d001' and month = date_trunc('month', current_date)::date), 0::numeric, 'родитель не видит списанный долг');

select as_user('00000000-0000-0000-0000-0000000000a1');
update subscriptions set written_off = false where player_id = '00000000-0000-0000-0000-00000000d001' and month = date_trunc('month', current_date)::date;
select is((select count(*)::int from debtors(date_trunc('month', current_date)::date) where full_name = 'Должник'), 1, 'списание можно снять');

select as_user('00000000-0000-0000-0000-0000000000c1');
update subscriptions set written_off = true;
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from subscriptions where written_off), 0, 'тренер не может списывать (строки не изменились)');

select * from finish();
rollback;
