-- pgTAP: локальный админ по локации (0085). Касса своих локаций — да; чужие локации, индивидуальные,
-- долги и обычный тренер — нет. Отчёт локального админа — только строки своих локаций.
begin;
create extension if not exists pgtap;
select plan(21);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 8901, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 8902, 'Гио', false),
  ('00000000-0000-0000-0000-0000000000c2', 8903, 'Тренер', false);
insert into groups (id, club_id, name, location) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9-A', 'Исани'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'U11', 'Отрачала'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'U13', 'Квартал');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e2', 'Боря', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e3', 'Вика', 'active');
insert into location_admins (user_id, location) values
  ('00000000-0000-0000-0000-0000000000b1', 'Исани'),
  ('00000000-0000-0000-0000-0000000000b1', 'Отрачала');
insert into equipment_catalog (club_id, kit, price, valid_from) values ('00000000-0000-0000-0000-00000000c001', 'Форма', 300, '2026-09-01');
insert into payments (player_id, amount, paid_on, method) values
  ('00000000-0000-0000-0000-00000000d001', 100, '2026-10-05', 'Наличные'),
  ('00000000-0000-0000-0000-00000000d003', 50, '2026-10-05', 'Перевод');
insert into camps (id, club_id, name, location, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c001', 'Сбор Исани', 'Исани', '2026-10-01', '2026-10-31'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-00000000c001', 'Сбор Квартал', 'Квартал', '2026-10-01', '2026-10-31');
insert into camp_participants (camp_id, player_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000d001'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-00000000d003');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;

-- заказы и занятия заводит глобальный админ
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'eq1', eq_create_order('00000000-0000-0000-0000-00000000d001', '[{"kit":"Форма"}]'::jsonb, null, '7', false, 'Исани', 300);
insert into ids select 'eq3', eq_create_order('00000000-0000-0000-0000-00000000d003', '[{"kit":"Форма"}]'::jsonb, null, '8', false, 'Квартал', 300);
insert into ids select 'ex1', extra_create_session('2026-10-06', 25, 'Исани');
select extra_add_player((select id from ids where k = 'ex1'), '00000000-0000-0000-0000-00000000d001');
insert into ids select 'ex3', extra_create_session('2026-10-07', 25, 'Квартал');
select extra_add_player((select id from ids where k = 'ex3'), '00000000-0000-0000-0000-00000000d003');
insert into ids select 'cp1', id from camp_participants where camp_id = '00000000-0000-0000-0000-0000000000c1';
insert into ids select 'cp3', id from camp_participants where camp_id = '00000000-0000-0000-0000-0000000000c3';

-- локальный админ Гио: видит только свои локации
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from payments), 1, 'Гио видит только платёж игрока своей локации (засеянный)');
select is((select count(*)::int from players), 2, 'Гио видит игроков своих локаций');
select is((select count(*)::int from groups), 2, 'Гио видит группы своих локаций');

-- запись в кассу своей локации
select lives_ok($$insert into payments (player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-00000000d001', 30, '2026-10-06', 'Наличные')$$, 'Гио принимает платёж в своей локации');
select throws_ok($$insert into payments (player_id, amount, paid_on, method) values ('00000000-0000-0000-0000-00000000d003', 10, '2026-10-06', 'Наличные')$$, '42501', null, 'Гио не принимает платёж в чужой локации');
select is(eq_add_payment((select id from ids where k = 'eq1'), 40, '2026-10-06', 'Наличные'), 40::numeric, 'Гио принимает оплату экипировки своей локации');
select throws_ok($$select eq_add_payment((select id from ids where k = 'eq3'), 40, '2026-10-06', 'Наличные')$$, '42501', 'forbidden', 'Гио не принимает оплату экипировки чужой локации');
select lives_ok($$select camp_pay((select id from ids where k = 'cp1'), 20, 'payment', '2026-10-06', 'Наличные', null)$$, 'Гио принимает сбор своей локации');
select throws_ok($$select camp_pay((select id from ids where k = 'cp3'), 20, 'payment', '2026-10-06', 'Наличные', null)$$, '42501', 'forbidden', 'Гио не принимает сбор чужой локации');
select lives_ok($$select extra_set_paid((select id from ids where k = 'ex1'), '00000000-0000-0000-0000-00000000d001', true, 'Наличные', null, '2026-10-06')$$, 'Гио принимает доп. занятие своей локации');
select throws_ok($$select extra_set_paid((select id from ids where k = 'ex3'), '00000000-0000-0000-0000-00000000d003', true, 'Наличные', null, '2026-10-07')$$, '42501', 'forbidden', 'Гио не принимает доп. занятие чужой локации');

-- всё, что не локальное, закрыто: долги и игроки чужих локаций
select throws_ok($$select debtors('2026-10-01')$$, '42501', 'forbidden', 'долги — только у глобального администратора');

-- отчёт Гио: 100 + 30 + 40 + 20 + 25 = 215 (строки чужих локаций не входят)
select is((select (cash_report('2026-10-01', '2026-10-31')->>'total')::numeric), 215::numeric, 'отчёт Гио — только его локации');
select is((select (cash_report('2026-10-01', '2026-10-31', 'Квартал')->>'total')::numeric), 0::numeric, 'отчёт Гио по чужой локации пуст');

-- глобальный админ видит всё: 215 + платёж Вики 50 = 265
select as_user('00000000-0000-0000-0000-0000000000a1');
select is((select (cash_report('2026-10-01', '2026-10-31')->>'total')::numeric), 265::numeric, 'глобальный админ видит все локации');

-- обычный тренер без локации: отчёт и касса закрыты
select as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select cash_report('2026-10-01', '2026-10-31')$$, '42501', 'forbidden', 'тренер без локации не видит отчёт');
select is((select count(*)::int from payments), 0, 'тренер без локации не видит платежи');
select throws_ok($$select eq_add_payment((select id from ids where k = 'eq1'), 10, '2026-10-06', 'Наличные')$$, '42501', 'forbidden', 'тренер не принимает оплату экипировки');

-- локальный админ не может выдавать себе права
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000b1', 'Квартал')$$, '42501', null, 'Гио не выдаёт себе локации');
select is((select count(*)::int from location_admins), 0, 'Гио не видит таблицу локальных админов');
select is((select my_locations()), array['Исани', 'Отрачала']::text[], 'Гио получает только свои локации');

select * from finish();
rollback;
