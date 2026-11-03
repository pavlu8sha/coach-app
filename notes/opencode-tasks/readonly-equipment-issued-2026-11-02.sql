-- Только чтение. Проверка статусов существующих заказов экипировки (#240, правило 0106).
-- Запускать в Supabase SQL Editor. Ничего не меняет.
--
-- «Выдан» = у заказа есть строки и по каждому kit выдано не меньше sum(quantity).
-- Остальные (частичные, без строк) = «Принят в заказ».
-- Миграция 0106 меняет только заказы в статусах accepted/issued, не трогая sewing/ready.

with demand as (
  select order_id, kit, sum(quantity)::int as need
  from equipment_order_lines
  group by order_id, kit
), supply as (
  select order_id, kit, count(*)::int as have
  from equipment_issues
  group by order_id, kit
), calc as (
  select o.id, o.status,
         exists (select 1 from demand d where d.order_id = o.id) as has_lines,
         not exists (
           select 1
           from demand d
           left join supply s on s.order_id = d.order_id and s.kit = d.kit
           where d.order_id = o.id and coalesce(s.have, 0) < d.need
         ) as all_issued
  from equipment_orders o
)
select
  count(*) as orders,
  count(*) filter (where all_issued) as should_be_issued,
  count(*) filter (where not all_issued) as should_be_accepted,
  count(*) filter (where status = 'issued' and not all_issued) as issued_but_partial,
  count(*) filter (where status <> 'issued' and all_issued) as fully_issued_but_not_issued
from calc;

-- Подробности: заказы, у которых текущий статус не совпадает с правилом.
with demand as (
  select order_id, kit, sum(quantity)::int as need
  from equipment_order_lines
  group by order_id, kit
), supply as (
  select order_id, kit, count(*)::int as have
  from equipment_issues
  group by order_id, kit
), calc as (
  select o.id, o.status,
         not exists (
           select 1
           from demand d
           left join supply s on s.order_id = d.order_id and s.kit = d.kit
           where d.order_id = o.id and coalesce(s.have, 0) < d.need
         ) and exists (select 1 from demand d where d.order_id = o.id) as all_issued
  from equipment_orders o
)
select o.id,
       p.full_name,
       o.ordered_on,
       o.status as current_status,
       case when c.all_issued then 'issued' else 'accepted' end as expected_status,
       o.total,
       o.paid,
       o.location,
       coalesce(
         jsonb_agg(
           jsonb_build_object('kit', d.kit, 'need', d.need, 'issued', coalesce(s.have, 0))
           order by d.kit
         ) filter (where d.kit is not null),
         '[]'::jsonb
       ) as lines
from calc c
join equipment_orders o on o.id = c.id
left join players p on p.id = o.player_id
left join demand d on d.order_id = o.id
left join supply s on s.order_id = o.id and s.kit = d.kit
where c.status in ('accepted', 'issued')
  and ((c.all_issued and c.status <> 'issued') or (not c.all_issued and c.status = 'issued'))
group by o.id, p.full_name, o.ordered_on, o.status, c.all_issued, o.total, o.paid, o.location
order by o.ordered_on nulls last, p.full_name;
