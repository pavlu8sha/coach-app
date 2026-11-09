-- pgTAP (#474): eq_add_payment не принимает дату платежа позже сегодняшней по Тбилиси.
-- Тест выполняется в транзакции и откатывается: реальные данные не пишутся.
begin;
create extension if not exists pgtap;
select plan(4);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c474', 'Клуб 474');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000004a1', 47401, 'Гил', true);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d474', '00000000-0000-0000-0000-00000000c474', 'Аня 474', 'active');
insert into equipment_catalog (club_id, kit, price, valid_from) values ('00000000-0000-0000-0000-00000000c474', 'Форма', 300, '2026-09-01');

create or replace function as_user_474(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
grant all on function as_user_474(uuid) to authenticated;

select as_user_474('00000000-0000-0000-0000-0000000004a1');
create temp table ids_474 (k text, id uuid);
grant all on ids_474 to authenticated;
insert into ids_474 select 'eq', eq_create_order('00000000-0000-0000-0000-00000000d474', '[{"kit":"Форма"}]'::jsonb, null, '7', false, 'Исани', 300);

-- будущая дата отклоняется прямым вызовом RPC
select throws_ok(
  $$select eq_add_payment((select id from ids_474 where k = 'eq'), 100, '2999-01-05', 'Наличные')$$,
  '22023', 'bad date', 'будущая дата отклоняется на сервере');

-- сегодняшняя дата по Тбилиси принимается
select lives_ok(
  $$select eq_add_payment((select id from ids_474 where k = 'eq'), 100, (now() at time zone 'Asia/Tbilisi')::date, 'Наличные')$$,
  'сегодняшняя дата по Тбилиси принимается');

-- предыдущая дата принимается
select lives_ok(
  $$select eq_add_payment((select id from ids_474 where k = 'eq'), 50, '2026-11-03', 'Перевод')$$,
  'предыдущая дата принимается');

-- без даты (null) оплата записывается, дата по умолчанию — сегодня
select lives_ok(
  $$select eq_add_payment((select id from ids_474 where k = 'eq'), 25, null, 'Наличные')$$,
  'без даты оплата принимается, дата по умолчанию сегодня');

select * from finish();
rollback;
