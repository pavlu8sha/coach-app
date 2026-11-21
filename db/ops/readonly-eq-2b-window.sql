-- Только чтение. #652 этап 2b: окно между 2c (0207) и 2b (0208).
-- Ищет заказы, созданные или правленные прежним клиентом уже после заморозки: у них скидка комплекта лежит в manual_adjustment,
-- а заморозки нет, поэтому автопересчёт 2b добавил бы вторую скидку. Ожидание: ноль строк. Ничего не меняет.
select o.id, o.player_id, o.created_at, o.ordered_on, o.total, eq_order_lines_sum(o.id) as lines_sum, o.manual_adjustment, o.bundle_adjustment, o.status, o.installment
  from equipment_orders o
 where o.legacy_bundle_id is null and o.manual_adjustment < 0
 order by o.created_at;
-- Сколько заказов не заморожено, но уже есть корректировка (для сверки с 0207: заморожено 18).
select count(*) filter (where legacy_bundle_id is not null) as frozen, count(*) filter (where manual_adjustment < 0) as with_manual_minus, count(*) as orders
  from equipment_orders;
