-- pgTAP: статус заказа экипировки следует за выдачей (0132).
begin;
create extension if not exists pgtap;
select plan(5);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9501, 'Админ', true);
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Аня', 'active');
insert into equipment_catalog (club_id, kit, price, valid_from) values
  ('00000000-0000-0000-0000-00000000c001', 'Форма', 300, '2026-09-01'),
  ('00000000-0000-0000-0000-00000000c001', 'Вратарская форма', 200, '2026-09-01');

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table ids (k text, id uuid);
grant all on ids to authenticated;

select as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'o1', eq_create_order('00000000-0000-0000-0000-00000000d001', '[{"kit":"Форма"},{"kit":"Вратарская форма"}]'::jsonb, null, '7', false, 'Isani', 500);

select eq_set_issued((select id from ids where k = 'o1'), 'Форма', true);
select is((select status from equipment_orders where id = (select id from ids where k = 'o1')), 'accepted', 'выдана часть: статус не меняется');

select eq_set_issued((select id from ids where k = 'o1'), 'Вратарская форма', true);
select is((select status from equipment_orders where id = (select id from ids where k = 'o1')), 'issued', 'выданы все вещи: «Выдан»');
select is((select count(*)::int from equipment_order_status_history where order_id = (select id from ids where k = 'o1') and status = 'issued'), 1, 'в истории одна запись «Выдан»');

select eq_set_issued((select id from ids where k = 'o1'), 'Вратарская форма', false);
select is((select status from equipment_orders where id = (select id from ids where k = 'o1')), 'ready', 'выдачу сняли: «Готов к выдаче»');

select eq_set_issued((select id from ids where k = 'o1'), 'Вратарская форма', true);
select is((select status from equipment_orders where id = (select id from ids where k = 'o1')), 'issued', 'выдали снова: «Выдан»');

select * from finish();
rollback;
