-- 0106 (#240): исправление статусов, ошибочно выставленных бэкфиллом 0098.
-- «Выдан» только если по каждой строке заказа выдано не меньше её количества.
-- Заказы без строк и частично выданные возвращаются в «Принят в заказ»; дальше их разбирает администратор вручную.

create or replace function eq_order_fully_issued(o uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from equipment_order_lines l where l.order_id = o)
    and not exists (
      select 1 from equipment_order_lines l
      where l.order_id = o
        and (select count(*) from equipment_issues i where i.order_id = o and i.kit = l.kit) < l.quantity
    )
$$;

revoke execute on function eq_order_fully_issued(uuid) from public, anon, authenticated;

create or replace function eq_fix_issued_statuses() returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update equipment_orders o
  set status = 'accepted'
  where o.status = 'issued'
    and not eq_order_fully_issued(o.id);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function eq_fix_issued_statuses() from public, anon, authenticated;

select eq_fix_issued_statuses();

-- Утверждённая владельцем формулировка — две строки. 0098 склеила их в одну.
create or replace function equipment_requirement() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(trim(value), '') from club_settings where key = 'equipment.required_text' and scope = '' limit 1),
    E'Тренировочный комплект FC Kickstart обязателен для всех воспитанников: клуб переходит на единую тренировочную экипировку.\nЕсли у ребёнка уже есть старая форма клуба, её можно использовать.'
  )
$$;

revoke execute on function equipment_requirement() from public, anon;
grant execute on function equipment_requirement() to authenticated;
