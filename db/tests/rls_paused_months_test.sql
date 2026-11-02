-- pgTAP: месяцы целиком на паузе не оплачиваются (0105), в том числе после возвращения.
begin;
create extension if not exists pgtap;
select plan(10);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8001, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 8003, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-A');
insert into prices (club_id, group_id, kind, amount, valid_from) values ('00000000-0000-0000-0000-00000000c001', null, 'subscription', 165, '2026-09-01');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вернулся после паузы', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Без паузы', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Вернулся посреди месяца', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now());
insert into club_settings (club_id, key, value) values ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true');

-- журнал: d001 на паузе с 30.09.2026, вернулся 01.11.2026; d003 вернулся 15.11.2026
insert into player_status_log (player_id, status, on_date, created_at) values
  ('00000000-0000-0000-0000-00000000d001', 'paused', '2026-09-30', '2026-11-02 10:00+00'),
  ('00000000-0000-0000-0000-00000000d001', 'active', '2026-11-01', '2026-11-02 11:00+00'),
  ('00000000-0000-0000-0000-00000000d003', 'paused', '2026-09-30', '2026-11-02 10:00+00'),
  ('00000000-0000-0000-0000-00000000d003', 'active', '2026-11-15', '2026-11-02 11:00+00');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- сама функция: границы паузы
select is(player_paused_month('00000000-0000-0000-0000-00000000d001', '2026-09-01'), false, 'сентябрь: пауза началась 30.09, месяц платный');
select is(player_paused_month('00000000-0000-0000-0000-00000000d001', '2026-10-01'), true, 'октябрь целиком на паузе');
select is(player_paused_month('00000000-0000-0000-0000-00000000d001', '2026-11-01'), false, 'вернулся 01.11: ноябрь платный');
select is(player_paused_month('00000000-0000-0000-0000-00000000d003', '2026-11-01'), false, 'вернулся 15.11: ноябрь платный (на паузе был не весь месяц)');
select is(player_paused_month('00000000-0000-0000-0000-00000000d002', '2026-10-01'), false, 'без журнала паузы нет');

-- закрыта для обычных пользователей
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select player_paused_month('00000000-0000-0000-0000-00000000d001', '2026-10-01')$$, '42501', null, 'родитель не вызывает функцию напрямую');
reset role;

-- parent_debts / debtors за прошлый месяц (нужны строки абонементов и дата не раньше октября 2026)
insert into subscriptions (player_id, group_id, month, amount_due) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e1', '2026-10-01', 165),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e1', '2026-10-01', 165);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from parent_debts() where player_id = '00000000-0000-0000-0000-00000000d001' and month = '2026-10-01'), 0, 'родитель: за октябрь на паузе долга нет, хотя игрок уже вернулся');
reset role;
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from debtors('2026-10-01') where full_name = 'Вернулся после паузы'), 0, 'список должников за октябрь: месяц паузы не считается');
select is((select count(*)::int from debtors('2026-10-01') where full_name = 'Без паузы'), 1, 'игрок без паузы остаётся должником');
reset role;
-- если за месяц паузы внесены деньги, долг считается как обычно
insert into payments (player_id, amount, paid_on, for_month) values ('00000000-0000-0000-0000-00000000d001', 50, '2026-10-10', '2026-10-01');
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select debt from debtors('2026-10-01') where full_name = 'Вернулся после паузы'), 115::numeric, 'внесено 50 за месяц паузы: долг 165 - 50');
select * from finish();
rollback;
