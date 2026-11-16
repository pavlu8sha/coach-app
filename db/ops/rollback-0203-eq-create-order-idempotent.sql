-- Откат миграции 0203 (#652 этап 1). Запускать только по решению владельца, в SQL Editor целиком, в одной транзакции.
-- Возвращает семиаргументную eq_create_order (тело 0102, права 0036). Заказы, созданные с ключом (request_id), сохраняются.
begin;
drop function if exists eq_create_order(uuid, jsonb, text, text, boolean, text, numeric, uuid);

create or replace function eq_create_order(p uuid, lines jsonb, insc text, num text, inst boolean, loc text, custom_total numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; oid uuid; l jsonb; pr numeric; tot numeric := 0; q int;
begin
  perform eq_assert_admin();
  select club_id into c from players where id = p;
  if c is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then raise exception 'no items' using errcode = '22023'; end if;
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

revoke execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric) from public, anon;
grant execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric) to authenticated;
commit;
