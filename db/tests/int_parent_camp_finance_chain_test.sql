-- Интеграционный сценарий: сбор на стыке записи родителя, мест, оплат, долга родителя (parent_dues) и уведомлений.
-- Модуль сборов проверен в rls_camp_*_test.sql; здесь одна цепочка проверяет, что запись, смена тарифа, отмена,
-- оплата, возврат и повторная запись согласованно меняют места, сумму к оплате, долг у родителя и историю платежей,
-- а сообщения администраторам уходят только после успешных операций.
-- Известные находки аудита сборов (C-01…C-17) здесь не закрепляются тестами. Данные вымышленные.
begin;
create extension if not exists pgtap;
select plan(32);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9931, 'Админ 1', true),
  ('00000000-0000-0000-0000-0000000000a2', 9932, 'Админ 2', true),
  ('00000000-0000-0000-0000-0000000000b1', 9933, 'Родитель 1 (Аня и Гриша)', false),
  ('00000000-0000-0000-0000-0000000000b2', 9934, 'Родитель 2 (Боря)', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'U9');
insert into players (id, club_id, group_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Аня', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Гриша', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000e1', 'Боря', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000b1', 'test', now()),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000b2', 'test', now());
insert into club_settings (club_id, key, value, scope) values
  ('00000000-0000-0000-0000-00000000c001', 'camps.notify', 'on', ''),
  ('00000000-0000-0000-0000-00000000c001', 'parent_debt_enabled', 'true', '');
-- сбор через месяц, два места, два тарифа, полная оплата до начала
insert into camps (id, club_id, name, starts_on, ends_on, capacity, full_payment_deadline, active) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000c001', 'Зимний сбор',
   (now() at time zone 'Asia/Tbilisi')::date + 30, (now() at time zone 'Asia/Tbilisi')::date + 37, 2, (now() at time zone 'Asia/Tbilisi')::date + 20, true);
insert into camp_tariffs (id, camp_id, name, price) values
  ('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000008a1', 'Полный', 300),
  ('00000000-0000-0000-0000-0000000008b2', '00000000-0000-0000-0000-0000000008a1', 'Без проживания', 200);

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
create temp table nsnap (n int);
create or replace function n_mark() returns void language sql as $$ delete from nsnap; insert into nsnap select count(*)::int from notifications $$;
create or replace function n_new() returns int language sql as $$ select (select count(*)::int from notifications) - (select n from nsnap) $$;
create or replace function camp_debt(p uuid) returns text language sql as $$
  select coalesce(string_agg(due::int || '/' || paid::int || '/' || debt::int, ','), 'нет') from parent_dues() where kind = 'camp' and player_id = p $$;
grant execute on function camp_debt(uuid) to authenticated;

-- ===== 1. Запись двух детей одной семьи, места, сообщения администраторам =====
select as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'pA', camp_parent_register('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000008b1', null);
insert into ids select 'pG', camp_parent_register('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000008b2', null);
select is(camp_debt('00000000-0000-0000-0000-00000000d001') || ' ' || camp_debt('00000000-0000-0000-0000-00000000d002'), '300/0/300 200/0/200',
  'у родителя два долга по сбору: сумма тарифа каждого ребёнка');
reset role;
select is((select count(*)::int from notifications where kind = 'camp_signup'), 4, 'каждый из двух администраторов получил по сообщению о каждой записи');
select is((select count(*)::int from notifications n join users u on u.id = n.user_id where n.kind like 'camp\_%' and not u.is_admin), 0, 'сообщения о записи на сбор не ушли родителям');

-- ===== 2. Неуспешные операции: места, чужие дети, повтор — без изменений и без сообщений =====
select n_mark();
select as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000008b1', null)$$, '22023', 'camp full', 'мест нет: запись отклонена');
select throws_ok($$select camp_parent_cancel((select id from ids where k = 'pA'))$$, '42501', 'forbidden', 'чужую запись на сбор отменить нельзя');
select throws_ok($$select camp_parent_update((select id from ids where k = 'pA'), '00000000-0000-0000-0000-0000000008b2', null)$$, '42501', 'forbidden', 'чужую запись на сбор изменить нельзя');
select is((select count(*)::int from camp_participants), 0, 'чужие участники сбора родителю не видны');
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000008b1', null)$$, '23505', 'already registered', 'повторная запись того же ребёнка отклонена');
reset role;
select is(n_new(), 0, 'отклонённые операции не поставили сообщений');
select is((select count(*)::int from camp_participants where status = 'registered'), 2, 'состав не изменился');

-- ===== 3. Частичная оплата, смена тарифа, полная оплата =====
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'pay1', camp_pay((select id from ids where k = 'pA'), 100, 'booking', null, 'Наличные', null);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(camp_debt('00000000-0000-0000-0000-00000000d001'), '300/100/200', 'частичная оплата уменьшила долг');
select camp_parent_update((select id from ids where k = 'pA'), '00000000-0000-0000-0000-0000000008b2', null);
select is(camp_debt('00000000-0000-0000-0000-00000000d001'), '200/100/100', 'смена тарифа родителем: новая сумма, внесённое сохранено, долг пересчитан');
reset role;
select is((select string_agg(amount::int::text, ',') from camp_payments where participant_id = (select id from ids where k = 'pA')), '100', 'смена тарифа не трогает платежи');
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'pay2', camp_pay((select id from ids where k = 'pA'), 100, 'payment', null, 'Перевод', null);
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(camp_debt('00000000-0000-0000-0000-00000000d001'), '200/200/0', 'полная оплата: долга нет');
select camp_parent_update((select id from ids where k = 'pG'), '00000000-0000-0000-0000-0000000008b1', null);
select is(camp_debt('00000000-0000-0000-0000-00000000d002'), '300/0/300', 'смена тарифа второго ребёнка не влияет на первого: свой долг пересчитан');
reset role;

-- ===== 4. Отмена оплаченной записи: место, долг, история, сообщение администраторам =====
delete from notifications;
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((camp_parent_cancel((select id from ids where k = 'pA'))->>'paid')::numeric::int, 200, 'отмена сообщает родителю, сколько внесено');
select is(camp_debt('00000000-0000-0000-0000-00000000d001'), 'нет', 'после отмены сбор пропал из долгов родителя');
select throws_ok($$select camp_parent_cancel((select id from ids where k = 'pA'))$$, '23505', 'already cancelled', 'повторная отмена отклонена');
reset role;
select is((select count(*)::int from notifications where kind = 'camp_cancel'), 2, 'оба администратора получили одно сообщение об отмене (повтор не дублирует)');
select ok((select bool_and(text like '%Внесено: 200.00 ₾%Нужно определить возврат%') from notifications where kind = 'camp_cancel'), 'в сообщении сумма внесённого и напоминание о возврате');
select is((select coalesce(sum(amount), 0)::int from camp_payments where participant_id = (select id from ids where k = 'pA')), 200, 'отмена не трогает историю платежей');
select as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$insert into ids select 'pB', camp_parent_register('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000008b1', null)$$,
  'освободившееся место сразу доступно другой семье');

-- ===== 5. Возврат и отмена платежа: защита от повторов, история не теряется =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select camp_cancel_payment((select id from ids where k = 'pay1'));
select throws_ok($$select camp_cancel_payment((select id from ids where k = 'pay1'))$$, '23505', 'already cancelled', 'повторная отмена того же платежа отклонена');
select throws_ok($$select camp_refund((select id from ids where k = 'pA'), 150, null, 'Больше остатка')$$, '22023', 'refund above paid', 'возврат больше остатка внесённого отклонён');
select camp_refund((select id from ids where k = 'pA'), 100, null, 'Возврат по условиям');
select throws_ok($$select camp_cancel_payment((select id from ids where k = 'pay2'))$$, '22023', 'paid below zero', 'отмена платежа после полного возврата отклонена (не уводит внесённое в минус)');
reset role;
select is((select string_agg(kind || ':' || amount::int, ',' order by kind, amount desc) from camp_payments where participant_id = (select id from ids where k = 'pA')),
  'booking:100,payment:100,refund:-100,refund:-100', 'история платежей: исходные платежи на месте, отмена платежа и возврат отдельными строками');
select is((select sum(amount)::int from camp_payments where participant_id = (select id from ids where k = 'pA')), 0, 'после отмены платежа и возврата внесённое равно нулю');

-- ===== 6. Повторная запись после отмены: место, сумма тарифа, долг с учётом истории =====
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select camp_parent_register('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000008b1', null)$$, '22023', 'camp full',
  'вернуться на сбор нельзя, пока место занято другой семьёй');
select as_user('00000000-0000-0000-0000-0000000000b2');
select camp_parent_cancel((select id from ids where k = 'pB'));
select as_user('00000000-0000-0000-0000-0000000000b1');
select is(camp_parent_register('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000008b1', null), (select id from ids where k = 'pA'),
  'повторная запись возвращает ту же строку участника (история одна)');
select is(camp_debt('00000000-0000-0000-0000-00000000d001'), '300/0/300', 'долг после возвращения учитывает всю историю платежей участника');

reset role;
select is((select count(*)::int from notifications n join users u on u.id = n.user_id where n.kind like 'camp\_%' and not u.is_admin), 0, 'за весь сценарий ни одно сообщение о сборе не ушло родителю');
select is((select count(*)::int from (select user_id, kind, text from notifications group by 1, 2, 3 having count(*) > 1) d), 0, 'нет одинаковых сообщений одному получателю');

select * from finish();
rollback;
