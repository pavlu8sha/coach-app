-- pgTAP: исправление статусов, ошибочно выставленных бэкфиллом 0098 (0106, #240).
begin;
create extension if not exists pgtap;
select plan(7);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c103', 'Клуб 0106');
insert into players (id, club_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000d103', '00000000-0000-0000-0000-00000000c103', 'Игрок', 'active');

-- a: две единицы, выдана одна; b: одна единица, выдана; c: строк нет.
insert into equipment_orders (id, club_id, player_id, status) values
  ('00000000-0000-0000-0000-000000010103', '00000000-0000-0000-0000-00000000c103', '00000000-0000-0000-0000-00000000d103', 'issued'),
  ('00000000-0000-0000-0000-000000010203', '00000000-0000-0000-0000-00000000c103', '00000000-0000-0000-0000-00000000d103', 'issued'),
  ('00000000-0000-0000-0000-000000010303', '00000000-0000-0000-0000-00000000c103', '00000000-0000-0000-0000-00000000d103', 'issued');
insert into equipment_order_lines (order_id, kit, quantity, unit_price) values
  ('00000000-0000-0000-0000-000000010103', 'Форма', 2, 100),
  ('00000000-0000-0000-0000-000000010203', 'Форма', 1, 100);
insert into equipment_issues (order_id, kit) values
  ('00000000-0000-0000-0000-000000010103', 'Форма'),
  ('00000000-0000-0000-0000-000000010203', 'Форма');

select is(eq_order_fully_issued('00000000-0000-0000-0000-000000010103'), false, 'две единицы, выдана одна: не полностью');
select is(eq_order_fully_issued('00000000-0000-0000-0000-000000010203'), true, 'одна единица выдана: полностью');
select is(eq_order_fully_issued('00000000-0000-0000-0000-000000010303'), false, 'без строк: не полностью');

select is(eq_fix_issued_statuses(), 2, 'исправлены два заказа: частичный и без строк');
select is((select status from equipment_orders where id = '00000000-0000-0000-0000-000000010103'), 'accepted', 'частичный заказ возвращён в «Принят в заказ»');
select is((select status from equipment_orders where id = '00000000-0000-0000-0000-000000010203'), 'issued', 'полностью выданный заказ остался «Выдан»');
select is(eq_fix_issued_statuses(), 0, 'повторный запуск ничего не меняет');

select * from finish();
rollback;
