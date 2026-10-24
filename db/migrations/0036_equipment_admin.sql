-- Экипировка для администратора (перенос из старого приложения: Equip.js, EquipIssue.js, Catalog.js).
-- Таблицы каталога и заказов — миграции 0003/0006. Здесь: выдача вещей и функции, которые держат правила в базе:
--   • сумма заказа считается по каталогу (цена на дату заказа), можно задать свою (например, скидка на полный набор);
--   • оплачено не меньше нуля и не больше суммы заказа;
--   • заказ с оплатой или выдачей удалить нельзя;
--   • номер на форме не повторяется внутри группы (u7-a и u7-b считаются одной группой «u7»).
-- Все функции — только администратор.
create table if not exists equipment_issues (
  order_id uuid not null references equipment_orders(id) on delete cascade,
  kit text not null,
  issued_on date not null default current_date,
  issued_by text,
  primary key (order_id, kit)
);
alter table equipment_issues enable row level security;
create policy equipment_issues_admin on equipment_issues for all using (is_admin()) with check (is_admin());
create policy equipment_issues_read on equipment_issues for select
  using (exists (select 1 from equipment_orders o where o.id = order_id and is_guardian_of(o.player_id)));
grant select, insert, update, delete on equipment_issues to authenticated, service_role;

create or replace function eq_assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function eq_num_norm(n text) returns text
language sql immutable as $$ select nullif(regexp_replace(replace(coalesce(n, ''), '/', ','), '\s+', '', 'g'), '') $$;

-- Занят ли номер другим заказом в той же группе
create or replace function eq_number_taken(o uuid, p uuid, n text) returns boolean
language sql stable security definer set search_path = public as $$
  select eq_num_norm(n) is not null and exists (
    select 1 from equipment_orders eo
    join players pl on pl.id = eo.player_id
    join groups g on g.id = pl.group_id
    where eo.id is distinct from o and eo.player_id is distinct from p
      and eq_num_norm(eo.number) = eq_num_norm(n)
      and regexp_replace(lower(g.name), '-.*$', '') = (select regexp_replace(lower(g2.name), '-.*$', '') from players p2 join groups g2 on g2.id = p2.group_id where p2.id = p))
$$;

create or replace function eq_price(c uuid, k text, d date) returns numeric
language sql stable security definer set search_path = public as $$
  select price from equipment_catalog where club_id = c and kit = k and valid_from <= d order by valid_from desc limit 1
$$;

-- lines: [{"kit": "...", "size": "...", "quantity": 1}]
create or replace function eq_create_order(p uuid, lines jsonb, insc text, num text, inst boolean, loc text, custom_total numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; oid uuid; l jsonb; pr numeric; tot numeric := 0; q int;
begin
  perform eq_assert_admin();
  select club_id into c from players where id = p;
  if c is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then raise exception 'no items' using errcode = '22023'; end if;
  if eq_number_taken(null, p, num) then raise exception 'number taken' using errcode = '23505'; end if;
  insert into equipment_orders (club_id, player_id, ordered_on, inscription, number, installment, total, paid, location)
  values (c, p, current_date, nullif(trim(insc), ''), nullif(trim(num), ''), coalesce(inst, false), 0, 0, nullif(trim(loc), '')) returning id into oid;
  for l in select * from jsonb_array_elements(lines) loop
    pr := eq_price(c, l->>'kit', current_date);
    if pr is null then raise exception 'kit not in catalog' using errcode = '22023'; end if;
    q := coalesce((l->>'quantity')::int, 1);
    insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values (oid, l->>'kit', nullif(l->>'size', ''), q, pr);
    tot := tot + pr * q;
  end loop;
  if custom_total is not null and custom_total < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  update equipment_orders set total = coalesce(custom_total, tot) where id = oid;
  return oid;
end $$;

create or replace function eq_edit_order(o uuid, insc text, num text, inst boolean, loc text, new_total numeric) returns void
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders;
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if new_total is null or new_total < eo.paid then raise exception 'total below paid' using errcode = '22023'; end if;
  if eq_number_taken(o, eo.player_id, num) then raise exception 'number taken' using errcode = '23505'; end if;
  update equipment_orders set inscription = nullif(trim(insc), ''), number = nullif(trim(num), ''), installment = coalesce(inst, false),
    location = nullif(trim(loc), ''), total = new_total where id = o;
end $$;

-- Платёж по заказу: положительный — оплата, отрицательный — исправление; итог между 0 и суммой заказа
create or replace function eq_add_payment(o uuid, amt numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; np numeric;
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if amt is null or amt = 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  np := eo.paid + amt;
  if np < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  if np > eo.total then raise exception 'paid above total' using errcode = '22023'; end if;
  update equipment_orders set paid = np where id = o;
  return np;
end $$;

create or replace function eq_set_issued(o uuid, k text, on_ boolean, who text default null, d date default current_date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform eq_assert_admin();
  if not exists (select 1 from equipment_order_lines where order_id = o and kit = k) then raise exception 'item not in order' using errcode = 'P0002'; end if;
  if on_ then
    insert into equipment_issues (order_id, kit, issued_on, issued_by) values (o, k, coalesce(d, current_date), nullif(trim(who), ''))
    on conflict (order_id, kit) do update set issued_on = excluded.issued_on, issued_by = excluded.issued_by;
  else
    delete from equipment_issues where order_id = o and kit = k;
  end if;
end $$;

create or replace function eq_delete_order(o uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform eq_assert_admin();
  if exists (select 1 from equipment_orders where id = o and paid > 0) then raise exception 'order has payments' using errcode = '22023'; end if;
  if exists (select 1 from equipment_issues where order_id = o) then raise exception 'order has issues' using errcode = '22023'; end if;
  delete from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
end $$;

-- Каталог: новая цена позиции с даты (старые заказы остаются по старой цене)
create or replace function eq_catalog_save(k text, pr numeric, d date default current_date) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform eq_assert_admin();
  if nullif(trim(k), '') is null or pr is null or pr < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  insert into equipment_catalog (club_id, kit, price, valid_from) values (c, trim(k), pr, coalesce(d, current_date))
  on conflict (club_id, kit, valid_from) do update set price = excluded.price;
end $$;

revoke execute on function eq_assert_admin(), eq_num_norm(text), eq_number_taken(uuid, uuid, text), eq_price(uuid, text, date) from public, anon, authenticated;
revoke execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric), eq_edit_order(uuid, text, text, boolean, text, numeric),
  eq_add_payment(uuid, numeric), eq_set_issued(uuid, text, boolean, text, date), eq_delete_order(uuid), eq_catalog_save(text, numeric, date) from public, anon;
grant execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric), eq_edit_order(uuid, text, text, boolean, text, numeric),
  eq_add_payment(uuid, numeric), eq_set_issued(uuid, text, boolean, text, date), eq_delete_order(uuid), eq_catalog_save(text, numeric, date) to authenticated;
