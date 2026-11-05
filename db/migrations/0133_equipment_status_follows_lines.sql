-- 0133: статус заказа экипировки следует и за составом заказа, и «Выдан» нельзя поставить вручную, пока выданы не все вещи.
-- Продолжение 0132: если в заказ со статусом «Выдан» добавили вещь (eq_add_line), он возвращается в «Готов к выдаче»;
-- если убрали последнюю невыданную вещь, становится «Выдан». Ручная смена статуса на «Выдан» требует, чтобы по каждой вещи заказа
-- стояла отметка выдачи. Суммы, оплаты и выдача не меняются.

create or replace function eq_all_kits_issued(o uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from equipment_order_lines l where l.order_id = o)
    and not exists (
      select 1 from equipment_order_lines l
      where l.order_id = o
        and not exists (select 1 from equipment_issues i where i.order_id = o and i.kit = l.kit)
    )
$$;
revoke execute on function eq_all_kits_issued(uuid) from public, anon, authenticated;

-- Один триггер на выдачу и на строки заказа.
create or replace function eq_sync_status_with_issues() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  oid uuid := coalesce(new.order_id, old.order_id);
  eo equipment_orders;
  target text;
begin
  select * into eo from equipment_orders where id = oid for update;
  if not found then return null; end if; -- заказ удаляется каскадом
  if eq_all_kits_issued(oid) and eo.status <> 'issued' then
    target := 'issued';
  elsif not eq_all_kits_issued(oid) and eo.status = 'issued' then
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

drop trigger if exists equipment_lines_sync_status on equipment_order_lines;
create trigger equipment_lines_sync_status
  after insert or update or delete on equipment_order_lines
  for each row execute function eq_sync_status_with_issues();

-- Ручная смена статуса: «Выдан» только когда выданы все вещи заказа.
create or replace function eq_set_order_status(o uuid, st text) returns void
language plpgsql security definer set search_path = public as $$
declare
  eo equipment_orders;
  steps text[] := array['accepted', 'sewing', 'ready', 'issued'];
  cur int;
  nxt int;
begin
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not (is_admin() or is_location_admin(eo.location)) then raise exception 'forbidden' using errcode = '42501'; end if;
  cur := array_position(steps, eo.status);
  nxt := array_position(steps, st);
  if nxt is null then raise exception 'bad status' using errcode = '22023'; end if;
  if abs(nxt - cur) <> 1 then raise exception 'bad transition' using errcode = '22023'; end if;
  if nxt < cur and not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if st = 'issued' and not eq_all_kits_issued(o) then raise exception 'not all issued' using errcode = '22023'; end if;
  update equipment_orders set status = st where id = o;
  insert into equipment_order_status_history (order_id, status, changed_by, changed_by_name)
  values (o, st, current_user_id(), (select display_name from users where id = current_user_id()));
end $$;
revoke execute on function eq_set_order_status(uuid, text) from public, anon;
grant execute on function eq_set_order_status(uuid, text) to authenticated;

-- Уже существующие заказы со статусом «Выдан», где не всё выдано (например, добавили вещь после выдачи).
with fixed as (
  update equipment_orders o set status = 'ready'
  where o.status = 'issued' and not eq_all_kits_issued(o.id)
  returning o.id
)
insert into equipment_order_status_history (order_id, status, changed_by_name)
select id, 'ready', 'автоматически (миграция 0133)' from fixed;
