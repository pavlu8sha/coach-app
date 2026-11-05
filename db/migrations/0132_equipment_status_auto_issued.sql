-- 0132: статус заказа экипировки следует за выдачей вещей.
-- Когда выданы все комплекты заказа, статус сам становится «Выдан» (с записью в историю статусов).
-- Если выдачу сняли, а статус был «Выдан», он возвращается в «Готов к выдаче».
-- Ручная смена статуса (eq_set_order_status) не меняется. Суммы, оплаты и строки заказа не трогаются.

create or replace function eq_sync_status_with_issues() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  oid uuid := coalesce(new.order_id, old.order_id);
  eo equipment_orders;
  full_ boolean;
  target text;
begin
  select * into eo from equipment_orders where id = oid for update;
  if not found then return null; end if; -- заказ удаляется каскадом
  full_ := exists (select 1 from equipment_order_lines l where l.order_id = oid)
    and not exists (
      select 1 from equipment_order_lines l
      where l.order_id = oid
        and not exists (select 1 from equipment_issues i where i.order_id = oid and i.kit = l.kit)
    );
  if full_ and eo.status <> 'issued' then
    target := 'issued';
  elsif not full_ and eo.status = 'issued' then
    target := 'ready';
  else
    return null;
  end if;
  update equipment_orders set status = target where id = oid;
  insert into equipment_order_status_history (order_id, status, changed_by, changed_by_name)
  values (oid, target, current_user_id(), (select display_name from users where id = current_user_id()));
  return null;
end $$;

revoke execute on function eq_sync_status_with_issues() from public, anon, authenticated;

drop trigger if exists equipment_issues_sync_status on equipment_issues;
create trigger equipment_issues_sync_status
  after insert or update or delete on equipment_issues
  for each row execute function eq_sync_status_with_issues();

-- Уже существующие заказы, где всё выдано, а статус не «Выдан» (например, Vaksin Lev, 05.11.2026).
with fixed as (
  update equipment_orders o set status = 'issued'
  where o.status <> 'issued'
    and exists (select 1 from equipment_order_lines l where l.order_id = o.id)
    and not exists (
      select 1 from equipment_order_lines l
      where l.order_id = o.id
        and not exists (select 1 from equipment_issues i where i.order_id = o.id and i.kit = l.kit)
    )
  returning o.id
)
insert into equipment_order_status_history (order_id, status, changed_by_name)
select id, 'issued', 'автоматически (миграция 0132)' from fixed;
