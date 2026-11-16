-- 0202 (#652 этап 1): eq_create_order с ключом идемпотентности и проверкой входных данных.
-- Условия: docs/acceptance/eq-652-stage1-create-order-2026-11-16.md. Тело пересобрано из 0102 (последнее определение:
-- grep -lEi "function +(public\.)?eq_create_order *\(" db/migrations/*.sql даёт 0036 и 0102), права как в 0036.
--  * новый необязательный параметр req uuid: повтор того же автора с тем же ключом, игроком и составом возвращает прежний заказ;
--  * тот же ключ для другого игрока или состава: 'request id reused'; параллельные повторы сериализуются advisory-блокировкой;
--  * количество строки: целое 1..10 (как в eq_edit_line), строка списка должна быть объектом;
--  * custom_total и права (только глобальный администратор) без изменений.
-- Старая семиаргументная версия удаляется, чтобы не осталось двух перегрузок для PostgREST.

drop function if exists eq_create_order(uuid, jsonb, text, text, boolean, text, numeric);

create or replace function eq_create_order(p uuid, lines jsonb, insc text, num text, inst boolean, loc text, custom_total numeric default null, req uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c uuid; oid uuid; l jsonb; pr numeric; tot numeric := 0; q int;
  uid uuid := current_user_id();
  norm jsonb := '[]'::jsonb;
  ex equipment_orders;
begin
  perform eq_assert_admin();
  select club_id into c from players where id = p;
  if c is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then raise exception 'no items' using errcode = '22023'; end if;
  if custom_total is not null and custom_total < 0 then raise exception 'bad amount' using errcode = '22023'; end if;

  -- Состав приводится к виду [название, размер, количество]; ошибка формы отклоняет запрос до любой записи.
  for l in select * from jsonb_array_elements(lines) loop
    if jsonb_typeof(l) <> 'object' then raise exception 'bad line' using errcode = '22023'; end if;
    if l->'quantity' is null or jsonb_typeof(l->'quantity') = 'null' then
      q := 1;
    elsif jsonb_typeof(l->'quantity') = 'number' and (l->>'quantity') ~ '^[0-9]{1,3}$' then
      q := (l->>'quantity')::int;
    else
      raise exception 'bad quantity' using errcode = '22023';
    end if;
    if q < 1 or q > 10 then raise exception 'bad quantity' using errcode = '22023'; end if;
    norm := norm || jsonb_build_array(jsonb_build_array(l->>'kit', coalesce(l->>'size', ''), q));
  end loop;

  if req is not null then
    -- Один и тот же ключ одного автора обрабатывается по очереди: второй вызов ждёт первого и видит его заказ.
    perform pg_advisory_xact_lock(hashtextextended('eq_create_order:' || uid::text || ':' || req::text, 0));
    select * into ex from equipment_orders where created_by = uid and request_id = req;
    if found then
      if ex.player_id is distinct from p
         or (select coalesce(jsonb_agg(x order by x), '[]'::jsonb)
               from (select jsonb_build_array(kit, coalesce(size, ''), quantity) as x from equipment_order_lines where order_id = ex.id) s)
            is distinct from (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from jsonb_array_elements(norm) as x) then
        raise exception 'request id reused' using errcode = '22023';
      end if;
      return ex.id;
    end if;
  end if;

  insert into equipment_orders (club_id, player_id, ordered_on, inscription, number, installment, total, paid, location, request_id)
  values (c, p, current_date, nullif(trim(insc), ''), nullif(trim(num), ''), coalesce(inst, false), 0, 0, nullif(trim(loc), ''), req) returning id into oid;
  for l in select * from jsonb_array_elements(norm) loop
    pr := eq_price(c, l->>0, current_date);
    if pr is null then raise exception 'kit not in catalog' using errcode = '22023'; end if;
    q := (l->>2)::int;
    insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values (oid, l->>0, nullif(l->>1, ''), q, pr);
    tot := tot + pr * q;
  end loop;
  update equipment_orders set total = coalesce(custom_total, tot) where id = oid;
  return oid;
end $$;

revoke execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric, uuid) from public, anon;
grant execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric, uuid) to authenticated;
