-- pgTAP: цены, долг родителя и список должников.
begin;
create extension if not exists pgtap;
select plan(22);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000c1', 8002, 'Тренер', false),
  ('00000000-0000-0000-0000-0000000000b1', 8003, 'Родитель А', false),
  ('00000000-0000-0000-0000-0000000000b2', 8004, 'Родитель Б', false);
insert into groups (id, club_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'weekends'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'Индивидуальные / Вратарские');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Платит частично'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Со скидкой'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Weekends'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Оплатил полностью'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e3', 'Индивидуальный'),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Чужой ребёнок');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000b2', 'test', now());
-- цены: общая 165, у weekends 130; с 2026-11 общая 170
insert into prices (club_id, group_id, kind, amount, valid_from) values
  ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 165, '2026-09-01'),
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'subscription', 130, '2026-09-01'),
  ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 170, '2099-01-01');
-- платежи: частично 100 в текущем месяце; скидочный внёс 50; полностью 165; weekends не платил; прошлый месяц (09.2026): частично 165 из 165 нет строки у Чужого
insert into payments (player_id, amount, paid_on) values
  ('00000000-0000-0000-0000-00000000d001', 100, date_trunc('month', current_date)),
  ('00000000-0000-0000-0000-00000000d002', 50, date_trunc('month', current_date)),
  ('00000000-0000-0000-0000-00000000d004', 165, date_trunc('month', current_date));
-- строки абонементов за сентябрь: у первого оплачено 60 (долг за прошлый месяц), у «Со скидкой» — скидка
insert into subscriptions (player_id, group_id, month, amount_due, discount) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', '2026-09-01', 60, false),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', date_trunc('month', current_date), 50, true);
insert into payments (player_id, amount, paid_on) values ('00000000-0000-0000-0000-00000000d001', 60, '2026-09-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Тариф
select is(tariff_for('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', '2026-10-01'), 165::numeric, 'общая цена');
select is(tariff_for('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', '2026-10-01'), 130::numeric, 'своя цена группы важнее общей');
select is(tariff_for('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', '2099-02-01'), 170::numeric, 'будущая цена действует с своего месяца, прошлые остаются по старой');
select is(tariff_for('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', '2026-08-01'), null::numeric, 'до начала действия цены нет');

-- Долг выключен по умолчанию
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parent_debts()), 0, 'пока настройка не включена, родитель долга не видит');
reset role;
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true');

-- Долг включён
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select debt from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d001' and month = date_trunc('month', current_date)::date), 65::numeric, 'текущий месяц: 165 - 100 = 65');
select is((select debt from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d001' and month = '2026-09-01'), 105::numeric, 'прошлый месяц со строкой абонемента: 165 - 60 = 105');
select is((select debt from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d002'), 0::numeric, 'скидка и что-то внесено: долга нет');
select is((select tariff from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d003'), 130::numeric, 'у группы weekends цена 130');
select is((select debt from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d003'), 130::numeric, 'не платил в weekends: долг 130');
select is((select count(*)::int from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d003' and month = '2026-09-01'), 0, 'прошлый месяц без строки абонемента долга не даёт (новый игрок)');
select is((select count(*)::int from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d006'), 0, 'чужого ребёнка родитель не видит');
select as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from parent_debts()), 1, 'другой родитель видит только своего ребёнка');
select as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from parent_debts()), 0, 'тренер без своих детей долгов не видит');

-- Должники для администратора
select throws_ok($$select * from debtors(date_trunc('month', current_date)::date)$$, '42501', 'forbidden', 'тренер не открывает список должников');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from debtors(date_trunc('month', current_date)::date)$$, '42501', 'forbidden', 'родитель не открывает список должников');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from debtors(date_trunc('month', current_date)::date)), 3, 'текущий месяц: должны трое (частично, weekends, чужой ребёнок); скидочный и оплативший не в списке');
select is((select count(*)::int from debtors(date_trunc('month', current_date)::date) where full_name = 'Индивидуальный'), 0, 'группа индивидуальных в долги не входит');
select is((select debt from debtors('2026-09-15') where full_name = 'Платит частично'), 105::numeric, 'прошлый месяц: только игроки со строкой абонемента, долг 105');
select is((select count(*)::int from debtors('2026-09-01')), 1, 'в прошлом месяце должен один (остальные без строки абонемента)');
select throws_ok($$select * from debtors('2026-08-01')$$, null, 'month out of range', 'месяц раньше начала сезона нельзя');
select throws_ok($$select * from debtors((date_trunc('month', current_date) + interval '1 month')::date)$$, null, 'month out of range', 'будущий месяц нельзя');

select * from finish();
rollback;
