-- Откат миграции 0208 (#652 этап 2b). Запускать только по решению владельца, в SQL Editor целиком, в одной транзакции.
-- Возвращает прежние тела функций (0203, 0205, 0125, 0185) без автоматического пересчёта и без подтверждения восстановления.
-- Скидки и записи комплектов, уже посчитанные автоматикой, остаются; платёжный журнал и paid не затрагиваются.
-- После отката итог заказа при правках снова меняется только на разницу, пересчёт возможен вручную (eq_bundle_recalc).
begin;
drop function if exists eq_restore_order(uuid, text);
drop function if exists eq_restore_order(uuid, text, boolean);
drop function if exists eq_restore_preview(uuid);
drop function if exists eq_bundle_run(uuid, text, boolean, text);
drop function if exists eq_bundle_run(uuid, text, boolean, text, uuid);
drop function if exists eq_bundle_auto(uuid, text);
drop function if exists eq_forfeit_mark(uuid, text);
drop function if exists eq_lock_player_of_order(uuid);

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

create or replace function eq_edit_order(o uuid, insc text, num text, inst boolean, loc text, new_total numeric) returns void
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders;
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if new_total is null or new_total < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  update equipment_orders set inscription = nullif(trim(insc), ''), number = nullif(trim(num), ''), installment = coalesce(inst, false),
    location = nullif(trim(loc), ''), total = new_total where id = o;
end $$;

create or replace function eq_edit_line(l uuid, sz text, qty int) returns void
language plpgsql security definer set search_path = public as $$
declare ln equipment_order_lines; eo equipment_orders; delta numeric;
begin
  perform eq_assert_admin();
  select * into ln from equipment_order_lines where id = l;
  if not found then raise exception 'line not found' using errcode = 'P0002'; end if;
  select * into eo from equipment_orders where id = ln.order_id for update;
  select * into ln from equipment_order_lines where id = l; -- повторно под блокировкой заказа: параллельная правка не даёт устаревшее количество
  if not found then raise exception 'line not found' using errcode = 'P0002'; end if;
  if qty is null or qty < 1 or qty > 10 then raise exception 'bad quantity' using errcode = '22023'; end if;
  delta := 0;
  if qty <> ln.quantity then
    if exists (select 1 from equipment_issues where order_id = ln.order_id and kit = ln.kit) then raise exception 'item issued' using errcode = '22023'; end if;
    delta := ln.unit_price * (qty - ln.quantity);
  end if;
  update equipment_order_lines set size = nullif(trim(sz), ''), quantity = qty where id = l;
  if delta <> 0 then update equipment_orders set total = total + delta where id = eo.id; end if;
end $$;

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

create or replace function eq_delete_line(l uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ln equipment_order_lines; eo equipment_orders; amt numeric;
begin
  perform eq_assert_admin();
  select * into ln from equipment_order_lines where id = l;
  if not found then raise exception 'line not found' using errcode = 'P0002'; end if;
  select * into eo from equipment_orders where id = ln.order_id for update;
  select * into ln from equipment_order_lines where id = l; -- повторно под блокировкой заказа: параллельная правка не даёт устаревшее количество
  if not found then raise exception 'line not found' using errcode = 'P0002'; end if;
  if exists (select 1 from equipment_issues where order_id = ln.order_id and kit = ln.kit) then raise exception 'item issued' using errcode = '22023'; end if;
  if (select count(*) from equipment_order_lines where order_id = ln.order_id) <= 1 then raise exception 'last line' using errcode = '22023'; end if;
  amt := ln.unit_price * ln.quantity;
  delete from equipment_order_lines where id = l;
  update equipment_orders set total = total - amt where id = eo.id;
end $$;

create or replace function eq_set_order_date(o uuid, d date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform eq_assert_admin();
  if d is null or d > current_date then raise exception 'bad date' using errcode = '22023'; end if;
  update equipment_orders set ordered_on = d where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
end $$;

create or replace function eq_delete_order(o uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform eq_assert_admin();
  if exists (select 1 from equipment_orders where id = o and source = 'parent') then raise exception 'parent order' using errcode = '22023'; end if;
  if exists (select 1 from equipment_order_events where order_id = o) then raise exception 'order has events' using errcode = '22023'; end if;
  if exists (select 1 from equipment_orders where id = o and paid > 0) then raise exception 'order has payments' using errcode = '22023'; end if;
  if exists (select 1 from equipment_issues where order_id = o) then raise exception 'order has issues' using errcode = '22023'; end if;
  delete from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
end $$;

create or replace function eq_cancel_order(o uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  eo equipment_orders;
  uid uuid := current_user_id();
  who text := (select display_name from users where id = current_user_id());
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if eo.status = 'cancelled' then raise exception 'already cancelled' using errcode = '22023'; end if;
  if nullif(trim(reason), '') is null then raise exception 'reason required' using errcode = '22023'; end if;
  perform set_config('eq.op', 'cancel', true);
  update equipment_orders
     set status = 'cancelled', status_before_cancel = eo.status, cancelled_at = now(), cancelled_by = uid, cancel_reason = trim(reason)
   where id = o;
  perform set_config('eq.op', '', true);
  insert into equipment_order_status_history (order_id, status, changed_by, changed_by_name) values (o, 'cancelled', uid, who);
  insert into equipment_order_events (order_id, event, reason, data, created_by, created_by_name)
  values (o, 'cancel', trim(reason),
          jsonb_build_object('from_status', eo.status, 'to_status', 'cancelled', 'paid', eo.paid, 'total', eo.total), uid, who);
end $$;

create or replace function eq_restore_order(o uuid, note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  eo equipment_orders;
  uid uuid := current_user_id();
  who text := (select display_name from users where id = current_user_id());
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if eo.status <> 'cancelled' then raise exception 'not cancelled' using errcode = '22023'; end if;
  perform set_config('eq.op', 'restore', true);
  update equipment_orders
     set status = eo.status_before_cancel, status_before_cancel = null, cancelled_at = null, cancelled_by = null, cancel_reason = null,
         restored_at = now(), restored_by = uid
   where id = o;
  perform set_config('eq.op', '', true);
  insert into equipment_order_status_history (order_id, status, changed_by, changed_by_name) values (o, eo.status_before_cancel, uid, who);
  insert into equipment_order_events (order_id, event, reason, data, created_by, created_by_name)
  values (o, 'restore', nullif(trim(note), ''),
          jsonb_build_object('from_status', 'cancelled', 'to_status', eo.status_before_cancel, 'paid', eo.paid, 'total', eo.total,
                             'cancelled_at', eo.cancelled_at, 'cancel_reason', eo.cancel_reason), uid, who);
end $$;

create or replace function eq_bundle_run(p uuid, mode text, do_apply boolean, why text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid; uid uuid := current_user_id();
  who text := (select display_name from users where id = current_user_id());
  inp jsonb; out jsonb; run_id bigint;
  st equipment_bundle_status; ab equipment_bundles; nb uuid;
  o record; new_adj numeric; new_total numeric; new_state text;
  changed boolean := false; same boolean; rev_reason text; closing uuid;
  rows jsonb := '[]'::jsonb; over numeric := 0; tie boolean;
  m_ids text; a_ids text; had_st boolean;
begin
  select club_id into c from players where id = p for update;
  if c is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  perform 1 from equipment_orders where player_id = p order by id for update;

  select * into st from equipment_bundle_status where player_id = p;
  had_st := found;
  if mode = 'auto' and had_st and st.state = 'unchecked' then
    return jsonb_build_object('skipped', 'unchecked');
  end if;

  inp := jsonb_build_object(
    'settings', jsonb_build_object('pct', eq_bundle_setting(c, 'equip.discPct'), 'round', eq_bundle_setting(c, 'equip.discRound'),
      'need_own', eq_bundle_setting(c, 'equip.discNeedOwn'), 'need_all', eq_bundle_setting(c, 'equip.discNeedAll'), 'full', eq_bundle_setting(c, 'equip.fullPrice')),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'status', e.status, 'created_at', e.created_at, 'ordered_on', e.ordered_on,
        'forfeited', e.discount_forfeited, 'frozen', e.legacy_bundle_id is not null) order by e.id) from equipment_orders e where e.player_id = p), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'order_id', l.order_id, 'kit', l.kit, 'quantity', l.quantity, 'unit_price', l.unit_price) order by l.id)
        from equipment_order_lines l join equipment_orders e on e.id = l.order_id where e.player_id = p), '[]'::jsonb));
  out := eq_bundle_calc(inp);
  tie := coalesce((out->>'tie_break_id')::boolean, false);
  closing := nullif(out->>'closing_order_id', '')::uuid;
  new_state := case when out->>'state' = 'unchecked' then 'unchecked' else 'ok' end;

  select * into ab from equipment_bundles where player_id = p and state = 'active';
  if do_apply then
    insert into equipment_bundle_runs (player_id, mode, trigger_reason, input, output, tie_break_id, applied, created_by)
    values (p, mode, why, inp, out, tie, true, uid) returning id into run_id;
  end if;

  -- заказы: bundle_adjustment, total, discount_state
  if do_apply then perform set_config('eq.op', 'recalc', true); end if;
  for o in select * from equipment_orders where player_id = p order by id loop
    if o.legacy_bundle_id is not null then
      rows := rows || jsonb_build_object('order_id', o.id, 'frozen', true, 'total_before', o.total, 'total_after', o.total, 'bundle_before', o.bundle_adjustment, 'bundle_after', o.bundle_adjustment, 'paid', o.paid);
      if o.status <> 'cancelled' then over := over + greatest(o.paid - o.total, 0); end if;
      continue;
    end if;
    new_adj := case when out->>'state' = 'active' and o.id = closing then -(out->>'discount')::numeric else 0 end;
    new_total := eq_order_lines_sum(o.id) + o.manual_adjustment + new_adj;
    rows := rows || jsonb_build_object('order_id', o.id, 'total_before', o.total, 'total_after', new_total, 'bundle_before', o.bundle_adjustment, 'bundle_after', new_adj,
                                       'paid', o.paid, 'cancelled', o.status = 'cancelled');
    if o.status <> 'cancelled' then over := over + greatest(o.paid - new_total, 0); end if;
    if new_adj is distinct from o.bundle_adjustment or new_total is distinct from o.total or new_state is distinct from o.discount_state then
      if new_adj is distinct from o.bundle_adjustment or new_total is distinct from o.total then changed := true; end if;
      if do_apply then
        update equipment_orders set bundle_adjustment = new_adj, total = new_total, discount_state = new_state where id = o.id;
        if new_adj is distinct from o.bundle_adjustment or new_total is distinct from o.total then
          insert into equipment_order_events (order_id, event, reason, data, created_by, created_by_name)
          values (o.id, 'recalc', why, jsonb_build_object('bundle_from', o.bundle_adjustment, 'bundle_to', new_adj, 'total_from', o.total, 'total_to', new_total,
                                                           'paid', o.paid, 'run_id', run_id, 'mode', mode), uid, who);
        end if;
      end if;
    end if;
  end loop;
  if do_apply then perform set_config('eq.op', '', true); end if;

  if do_apply then
    -- запись комплекта: любое изменение результата = отзыв прежней записи + новая
    same := false;
    if ab.id is not null and out->>'state' = 'active' then
      select string_agg(x, ',' order by x) into m_ids from (select m->>'line_id' x from jsonb_array_elements(out->'members') m) q;
      select string_agg(x, ',' order by x) into a_ids from (select m->>'line_id' x from jsonb_array_elements(ab.members) m) q;
      same := ab.closing_order_id = closing and ab.base = (out->>'base')::numeric and ab.pct = (out->>'pct')::numeric
              and ab.round_to = (out->>'round')::numeric and ab.discount = (out->>'discount')::numeric and m_ids = a_ids;
    end if;
    nb := ab.id;
    if ab.id is not null and not same then
      rev_reason := case
        when why = 'restore' then 'restore_recalc'
        when out->>'reason' in ('forfeited_order', 'need_all_failed', 'settings_invalid') then out->>'reason'
        when exists (select 1 from equipment_orders where id = ab.closing_order_id and status = 'cancelled') then 'closing_order_cancelled'
        when exists (select 1 from jsonb_array_elements(ab.members) m join equipment_orders e on e.id = (m->>'order_id')::uuid where e.status = 'cancelled') then 'member_order_cancelled'
        when why = 'manual' then 'manual'
        else 'composition_changed' end;
      update equipment_bundles set state = 'revoked', revoked_at = now(), revoked_by = uid, revoked_reason = rev_reason where id = ab.id;
      nb := null;
    end if;
    if out->>'state' = 'active' and (ab.id is null or not same) then
      insert into equipment_bundles (player_id, closing_order_id, members, base, pct, round_to, discount, created_reason, created_by)
      values (p, closing, out->'members', (out->>'base')::numeric, (out->>'pct')::numeric, (out->>'round')::numeric, (out->>'discount')::numeric,
              case when why in ('create', 'edit', 'cancel', 'restore') then why else 'manual' end, uid) returning id into nb;
    end if;
    if mode = 'manual' or not had_st
       or st.state is distinct from out->>'state' or st.reason is distinct from out->>'reason'
       or st.reason_detail is distinct from out->>'detail' or st.bundle_id is distinct from nb then
      insert into equipment_bundle_status (player_id, state, reason, reason_detail, bundle_id, checked_at, checked_by, last_run_id)
      values (p, out->>'state', out->>'reason', out->>'detail', nb, now(), uid, run_id)
      on conflict (player_id) do update set state = excluded.state, reason = excluded.reason, reason_detail = excluded.reason_detail,
        bundle_id = excluded.bundle_id, checked_at = excluded.checked_at, checked_by = excluded.checked_by, last_run_id = excluded.last_run_id;
    end if;
  end if;

  return jsonb_build_object('state', out->>'state', 'reason', out->>'reason', 'detail', out->>'detail', 'closing_order_id', closing,
    'discount', coalesce((out->>'discount')::numeric, 0), 'changed', changed, 'overpaid', over, 'tie_break_id', tie, 'orders', rows,
    'run_id', run_id, 'blocking', out->'blocking');
end $$;

revoke execute on function eq_bundle_run(uuid, text, boolean, text) from public, anon, authenticated;
revoke execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric, uuid), eq_edit_order(uuid, text, text, boolean, text, numeric),
  eq_edit_line(uuid, text, int), eq_add_line(uuid, text, text, int), eq_delete_line(uuid), eq_set_order_date(uuid, date), eq_delete_order(uuid),
  eq_cancel_order(uuid, text), eq_restore_order(uuid, text) from public, anon;
grant execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric, uuid), eq_edit_order(uuid, text, text, boolean, text, numeric),
  eq_edit_line(uuid, text, int), eq_add_line(uuid, text, text, int), eq_delete_line(uuid), eq_set_order_date(uuid, date), eq_delete_order(uuid),
  eq_cancel_order(uuid, text), eq_restore_order(uuid, text) to authenticated;
commit;
