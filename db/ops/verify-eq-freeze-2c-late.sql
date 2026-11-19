-- Только чтение. Проверка после db/ops/eq-freeze-2c-late.sql. Ожидание: unfrozen_with_discount = 0; frozen = 19 (18 после 0207 + заказы позднего окна и участники);
-- late_bundles = 1; разделы total/paid/orders те же, что до скрипта (38860 / 32435 / 155).
select
  (select count(*) from equipment_orders where legacy_bundle_id is null and status <> 'cancelled' and manual_adjustment < 0) as unfrozen_with_discount,
  (select count(*) from equipment_orders where legacy_bundle_id is not null) as frozen,
  (select count(*) from equipment_legacy_bundles where reason like '%(позднее окно 2c, db/ops)%') as late_bundles,
  (select count(*) from equipment_orders where total <> eq_order_lines_sum(id) + manual_adjustment + bundle_adjustment) as total_broken,
  (select coalesce(sum(total), 0) from equipment_orders) as total_sum,
  (select coalesce(sum(paid), 0) from equipment_orders) as paid_sum,
  (select count(*) from equipment_orders) as orders;
