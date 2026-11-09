-- Read-only: все заказы дождевиков (кто заказал, размер, количество) для заказа шитья.
-- Только select, ничего не меняет. Запускать Павлом в SQL Editor, результат выгрузить в CSV.
select
  o.ordered_on                  as "дата заказа",
  o.number                      as "номер",
  p.full_name                   as "игрок",
  g.name                        as "группа",
  o.location                    as "локация",
  l.kit                         as "вещь",
  l.size                        as "размер",
  l.quantity                    as "количество",
  o.id                          as "id заказа"
from equipment_order_lines l
join equipment_orders o on o.id = l.order_id
left join players p     on p.id = o.player_id
left join groups g     on g.id = p.group_id
where l.kit ilike '%дождевик%'
order by o.ordered_on, p.full_name;
