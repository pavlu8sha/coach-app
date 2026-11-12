-- pgTAP: статус заказа экипировки следует за выдачей (0132).
begin;
create extension if not exists pgtap;
select plan(12);

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

-- 0133: добавили вещь в заказ со статусом «Выдан» → «Готов к выдаче»
insert into equipment_catalog (club_id, kit, price, valid_from) values ('00000000-0000-0000-0000-00000000c001', 'Костюм', 150, '2026-09-01');
select eq_add_line((select id from ids where k = 'o1'), 'Костюм', '128', 1);
select is((select status from equipment_orders where id = (select id from ids where k = 'o1')), 'ready', 'добавили невыданную вещь: «Готов к выдаче»');
select is((select count(*)::int from equipment_order_status_history where order_id = (select id from ids where k = 'o1') and status = 'ready' and changed_by_name = 'Админ'), 2, 'возврат записан в историю (после снятия выдачи и после добавления вещи)');

-- вручную «Выдан» нельзя, пока выдана не каждая вещь
select throws_ok($$select eq_set_order_status((select id from ids where k = 'o1'), 'issued')$$, '22023', 'not all issued', 'вручную «Выдан» нельзя, пока не выданы все вещи');
select eq_set_issued((select id from ids where k = 'o1'), 'Костюм', true);
select is((select status from equipment_orders where id = (select id from ids where k = 'o1')), 'issued', 'выдали последнюю вещь: «Выдан»');

-- 0185 (#471 PR-1): отменённый выданный заказ автостатус не трогает, после восстановления статус прежний
select eq_cancel_order((select id from ids where k = 'o1'), 'проверка');
select is((select status from equipment_orders where id = (select id from ids where k = 'o1')), 'cancelled', '0185: отменённый заказ остаётся «Отменён», хотя выдано всё');
select throws_ok($$select eq_set_issued((select id from ids where k = 'o1'), 'Костюм', false)$$, '22023', 'order cancelled', '0185: выдачу отменённого не снять, автостатус не сработает');
select eq_restore_order((select id from ids where k = 'o1'), null);
select is((select status from equipment_orders where id = (select id from ids where k = 'o1')), 'issued', '0185: после восстановления снова «Выдан»');

select * from finish();
rollback;
