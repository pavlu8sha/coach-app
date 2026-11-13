-- pgTAP: журнал изменений тарифов и сборов (0191, аудит C-06), docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 77-81.
begin;
create extension if not exists pgtap;
select plan(22);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9981, 'Админ', true),
  ('00000000-0000-0000-0000-0000000000b1', 9982, 'Родитель', false),
  ('00000000-0000-0000-0000-0000000000d1', 9983, 'Локальный админ', false);
insert into location_admins (user_id, location) values ('00000000-0000-0000-0000-0000000000d1', 'Исани');
create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
grant execute on function as_user(uuid) to public;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

-- ===== 77, 80. Запись через функции =====
select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'camp', camp_save(null, 'Зимний сбор', 'Исани', '2099-01-03', '2099-01-10', 100, null, '2098-12-20', true);
select is((select count(*)::int from camp_change_log where entity = 'camp' and op = 'insert' and entity_id = (select id from ids where k = 'camp')), 1, 'создание сбора записано');
select is((select changed_by from camp_change_log where entity = 'camp' and op = 'insert'), '00000000-0000-0000-0000-0000000000a1'::uuid, 'автор создания — вошедший администратор');
select camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 1000, true);
select is((select count(*)::int from camp_change_log where entity = 'tariff' and op = 'insert'), 1, 'создание тарифа записано');
select camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 1200, true);
select is((select old_values::text || '|' || new_values::text from camp_change_log where entity = 'tariff' and op = 'update'),
          '{"price": 1000.00}|{"price": 1200.00}', 'изменение цены: только изменённое поле, прежнее и новое значение');
select camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 1200, true);
select is((select count(*)::int from camp_change_log where entity = 'tariff' and op = 'update'), 1, 'повторное сохранение без изменений строки не пишет');
select camp_tariff_save((select id from ids where k = 'camp'), 'Футболист', 1200, false);
select is((select new_values::text from camp_change_log where entity = 'tariff' and op = 'update' order by id desc limit 1), '{"active": false}', 'снятие тарифа с активности записано');
select camp_save((select id from ids where k = 'camp'), 'Зимний сбор', 'Исани', '2099-01-04', '2099-01-10', 150, null, '2098-12-20', true);
select is((select old_values::text || '|' || new_values::text from camp_change_log where entity = 'camp' and op = 'update'),
          '{"starts_on": "2099-01-03", "booking_fee": 100.00}|{"starts_on": "2099-01-04", "booking_fee": 150.00}', 'изменение дат и брони сбора записано');
select camp_set_public((select id from ids where k = 'camp'), 'winter-2099', 20);
select is((select count(*)::int from camp_change_log where entity = 'camp' and op = 'update' and new_values ? 'capacity'), 1, 'лимит и ссылка (camp_set_public) записаны');
select is((select count(*)::int from camp_change_log where camp_id = (select id from ids where k = 'camp')), 6, 'всего шесть записей по сбору');

-- ===== 78. Чтение и неизменяемость =====
select is((select count(*)::int from camp_change_log), 6, 'администратор читает журнал');
select throws_ok($$update camp_change_log set op = 'delete'$$, '42501', null, 'администратор журнал не правит (нет прав)');
select throws_ok($$delete from camp_change_log$$, '42501', null, 'администратор журнал не удаляет');
select throws_ok($$insert into camp_change_log (camp_id, entity, entity_id, op) values ((select id from ids where k = 'camp'), 'camp', (select id from ids where k = 'camp'), 'update')$$, '42501', null, 'прямая запись в журнал закрыта');
reset role;
select throws_ok($$update camp_change_log set op = 'delete'$$, 'P0001', 'immutable', 'владелец базы: триггер запрещает правку');
select throws_ok($$delete from camp_change_log$$, 'P0001', 'immutable', 'владелец базы: триггер запрещает удаление');
select throws_ok($$truncate camp_change_log$$, 'P0001', 'immutable', 'очистка журнала отклоняется');
select as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from camp_change_log), 0, 'родитель журнал не видит');
select as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from camp_change_log), 0, 'локальный администратор журнал не видит');

-- ===== 79. Прямая запись в camps закрыта =====
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$update camps set name = 'Взлом' where id = (select id from ids where k = 'camp')$$, '42501', null, 'администратор не правит camps прямым запросом');
select throws_ok($$delete from camps where id = (select id from ids where k = 'camp')$$, '42501', null, 'администратор не удаляет camps прямым запросом');
select throws_ok($$insert into camps (club_id, name, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000c001', 'X', '2099-02-01', '2099-02-02')$$, '42501', null, 'администратор не вставляет в camps прямым запросом');
reset role;
-- владелец базы и служебные правки тоже попадают в журнал (автор пустой)
select set_config('request.jwt.claims', '{}', true);
update camps set location = 'Сабуртало' where id = (select id from ids where k = 'camp');
select is((select changed_by is null from camp_change_log where entity = 'camp' and op = 'update' and new_values ? 'location'), true, 'правка владельцем базы записана без автора');

select * from finish();
rollback;
