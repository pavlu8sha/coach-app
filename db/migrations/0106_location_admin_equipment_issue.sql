-- 0106: локальный админ отмечает выдачу экипировки заказов своей локации (тренер Гио: Isani, Ortachala).
-- Глобальный is_admin() не меняется. Локальный админ может только ОТМЕЧАТЬ выдачу комплекта заказа своей локации;
-- снять выдачу, править заказ, каталог, статус и удаление остаются у глобального администратора.
-- Не выдаёт и не меняет права: запись в location_admins делает владелец отдельно.

-- Чтение выдачи своей локации (нужно экрану: какие комплекты уже выданы).
drop policy if exists equipment_issues_location_read on equipment_issues;
create policy equipment_issues_location_read on equipment_issues for select
  using (exists (select 1 from equipment_orders eo where eo.id = order_id and is_location_admin(eo.location)));

-- Та же сигнатура, что в 0036 (права execute сохраняются). Для локального админа: только заказы своей локации и только «выдать».
create or replace function eq_set_issued(o uuid, k text, on_ boolean, who text default null, d date default current_date) returns void
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; by text;
begin
  if not (is_admin() or has_location_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into eo from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not is_admin() then
    if not is_location_admin(eo.location) then raise exception 'forbidden' using errcode = '42501'; end if;
    if not on_ then raise exception 'forbidden' using errcode = '42501'; end if;
    -- уже выдано: отметку локальный админ не перезаписывает
    if exists (select 1 from equipment_issues where order_id = o and kit = k) then return; end if;
  end if;
  if not exists (select 1 from equipment_order_lines where order_id = o and kit = k) then raise exception 'item not in order' using errcode = 'P0002'; end if;
  if on_ then
    -- кто выдал: введённое имя, иначе имя пользователя из профиля
    by := coalesce(nullif(trim(who), ''), (select u.display_name from users u where u.id = current_user_id()));
    insert into equipment_issues (order_id, kit, issued_on, issued_by) values (o, k, coalesce(d, current_date), by)
    on conflict (order_id, kit) do update set issued_on = excluded.issued_on, issued_by = excluded.issued_by;
  else
    delete from equipment_issues where order_id = o and kit = k;
  end if;
end $$;
