-- ТОЛЬКО ЧТЕНИЕ. Запустить в Supabase → SQL Editor, результат скачать как CSV (БАЗА.csv).
-- Подставьте uuid клуба вместо <CLUB_ID>.
select o.external_ord_id as ord, p.external_id as player_ext, o.inscription, o.number, o.installment,
       o.total, o.paid, o.location,
       (select jsonb_agg(jsonb_build_object('kit', l.kit, 'size', l.size, 'quantity', l.quantity) order by l.kit)
          from equipment_order_lines l where l.order_id = o.id)::text as lines
from equipment_orders o
left join players p on p.id = o.player_id
where o.club_id = '<CLUB_ID>'
order by o.external_ord_id;
