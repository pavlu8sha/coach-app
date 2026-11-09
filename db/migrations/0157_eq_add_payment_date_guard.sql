-- #474: дата платежа экипировки не может быть позже сегодняшней по Тбилиси.
-- Клиент уже не даёт выбрать будущую дату; эта проверка закрывает прямой вызов RPC.
-- Тело взято из 0085 (права админа и локального админа), добавлена только проверка даты.
-- Сигнатура прежняя, поэтому права выполнения сохраняются.

create or replace function eq_add_payment(o uuid, amt numeric, d date default null, mth text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; np numeric;
begin
  if not (is_admin() or has_location_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not is_admin() and not is_location_admin(eo.location) then raise exception 'forbidden' using errcode = '42501'; end if;
  if amt is null or amt = 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if d is not null and d > tbilisi_day(now()) then raise exception 'bad date' using errcode = '22023'; end if;
  perform service_method_ok(mth);
  np := eo.paid + amt;
  if np < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  if np > eo.total then raise exception 'paid above total' using errcode = '22023'; end if;
  update equipment_orders set paid = np where id = o;
  perform service_payment_add('equipment', o, eo.player_id, amt, d, mth);
  return np;
end $$;
