-- Только чтение. Заказы экипировки с неполными данными. Имён нет: только код игрока KS-xxxx.
-- Блок 1: что именно не заполнено (колонка «нет» перечисляет пропуски).
with g as (
  select o.id, o.external_ord_id as ord, p.external_id as код, gr.name as группа, o.total,
    (select string_agg(l.kit, ' + ' order by l.kit) from equipment_order_lines l where l.order_id = o.id) as комплект,
    exists (select 1 from equipment_order_lines l where l.order_id = o.id and coalesce(trim(l.size),'') = '') as нет_размера,
    coalesce(trim(o.number),'') = '' as нет_номера,
    coalesce(trim(o.inscription),'') = '' as нет_надписи,
    case when gr.name ~* '^U13-[BC]$' then 'U13-B/C' when gr.name ~* '^U13' then gr.name else regexp_replace(coalesce(gr.name,''), '-[A-Za-z0-9]+$', '') end as кат
  from equipment_orders o
  left join players p on p.id = o.player_id
  left join groups gr on gr.id = p.group_id
)
select ord, код, группа, комплект, total as сумма,
  concat_ws(', ', case when комплект is null then 'комплект' end, case when not (total > 0) then 'сумма' end,
    case when нет_размера then 'размер' end, case when нет_номера then 'номер' end, case when нет_надписи then 'надпись' end) as нет
from g
where комплект is null or not (total > 0) or нет_размера or нет_номера or нет_надписи
order by группа, код;

-- Блок 2: повторы номеров в категории (U10-A и U10-B вместе, U13-B и U13-C вместе).
with g as (
  select o.external_ord_id as ord, p.external_id as код, gr.name as группа, trim(t) as номер,
    case when gr.name ~* '^U13-[BC]$' then 'U13-B/C' when gr.name ~* '^U13' then gr.name else regexp_replace(coalesce(gr.name,''), '-[A-Za-z0-9]+$', '') end as кат
  from equipment_orders o
  join players p on p.id = o.player_id
  left join groups gr on gr.id = p.group_id
  cross join lateral regexp_split_to_table(coalesce(o.number,''), '[/,]') t
  where trim(t) <> ''
)
select кат, номер, count(*) as заказов, string_agg(ord || ' ' || код, '; ' order by ord) as кто
from g group by кат, номер having count(*) > 1 order by кат, номер;
