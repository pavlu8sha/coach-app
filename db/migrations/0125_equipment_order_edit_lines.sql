-- 0125: правка заказа экипировки — размер и количество по каждой строке, добавить и удалить вещь, дата заказа.
-- Только глобальный администратор. Цена строки (unit_price) не меняется; сумма заказа сдвигается на разницу,
-- поэтому ручная сумма и скидка на комплект сохраняются. Нельзя опустить сумму ниже уже оплаченного.
-- Вещь, по которой стоит отметка выдачи, менять нельзя (кроме размера): сначала снимите выдачу.

-- Размер (всегда) и количество (если вещь не выдана) одной строки.
create or replace function eq_edit_line(l uuid, sz text, qty int) returns void
language plpgsql security definer set search_path = public as $$
declare ln equipment_order_lines; eo equipment_orders; delta numeric;
begin
  perform eq_assert_admin();
  select * into ln from equipment_order_lines where id = l;
  if not found then raise exception 'line not found' using errcode = 'P0002'; end if;
  select * into eo from equipment_orders where id = ln.order_id for update;
  if qty is null or qty < 1 or qty > 10 then raise exception 'bad quantity' using errcode = '22023'; end if;
  if qty <> ln.quantity then
    if exists (select 1 from equipment_issues where order_id = ln.order_id and kit = ln.kit) then raise exception 'item issued' using errcode = '22023'; end if;
    delta := ln.unit_price * (qty - ln.quantity);
    if eo.total + delta < eo.paid then raise exception 'total below paid' using errcode = '22023'; end if;
    update equipment_orders set total = total + delta where id = eo.id;
  end if;
  update equipment_order_lines set size = nullif(trim(sz), ''), quantity = qty where id = l;
end $$;

-- Добавить вещь в заказ по текущей цене каталога.
create or replace function eq_add_line(o uuid, k text, sz text, qty int default 1) returns uuid
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; pr numeric; lid uuid;
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if qty is null or qty < 1 or qty > 10 then raise exception 'bad quantity' using errcode = '22023'; end if;
  if exists (select 1 from equipment_issues where order_id = o and kit = k) then raise exception 'item issued' using errcode = '22023'; end if;
  pr := eq_price(eo.club_id, k, current_date);
  if pr is null then raise exception 'kit not in catalog' using errcode = '22023'; end if;
  insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values (o, k, nullif(trim(sz), ''), qty, pr) returning id into lid;
  update equipment_orders set total = total + pr * qty where id = o;
  return lid;
end $$;

-- Убрать вещь из заказа. Последнюю строку удалять нельзя (для этого есть удаление заказа).
create or replace function eq_delete_line(l uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ln equipment_order_lines; eo equipment_orders; amt numeric;
begin
  perform eq_assert_admin();
  select * into ln from equipment_order_lines where id = l;
  if not found then raise exception 'line not found' using errcode = 'P0002'; end if;
  select * into eo from equipment_orders where id = ln.order_id for update;
  if exists (select 1 from equipment_issues where order_id = ln.order_id and kit = ln.kit) then raise exception 'item issued' using errcode = '22023'; end if;
  if (select count(*) from equipment_order_lines where order_id = ln.order_id) <= 1 then raise exception 'last line' using errcode = '22023'; end if;
  amt := ln.unit_price * ln.quantity;
  if eo.total - amt < eo.paid then raise exception 'total below paid' using errcode = '22023'; end if;
  delete from equipment_order_lines where id = l;
  update equipment_orders set total = total - amt where id = eo.id;
end $$;

-- Дата заказа (не в будущем).
create or replace function eq_set_order_date(o uuid, d date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform eq_assert_admin();
  if d is null or d > current_date then raise exception 'bad date' using errcode = '22023'; end if;
  update equipment_orders set ordered_on = d where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
end $$;

revoke execute on function eq_edit_line(uuid, text, int), eq_add_line(uuid, text, text, int), eq_delete_line(uuid), eq_set_order_date(uuid, date) from public, anon;
grant execute on function eq_edit_line(uuid, text, int), eq_add_line(uuid, text, text, int), eq_delete_line(uuid), eq_set_order_date(uuid, date) to authenticated;
