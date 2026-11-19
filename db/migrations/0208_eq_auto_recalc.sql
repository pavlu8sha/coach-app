-- 0208: #652, этап 2b. Автоматический пересчёт скидки за комплект (серверный расчёт подключён к заказам экипировки).
-- Условия: docs/acceptance/eq-652-stage2b-auto-recalc-0208-2026-11-19.md (Н1–Н12) и часть 2b в docs/acceptance/eq-652-stage2-bundle-discount-2026-11-16.md (Б1–Б8).
-- Порядок применения строго: 0205 -> 0207 -> 0208. Миграцию применяет только Павел после preflight и db/ops/readonly-eq-2b-window.sql.
-- Откат: db/ops/rollback-0208-eq-auto-recalc.sql. Платёжный журнал и paid не затрагиваются.

-- 0. Самопроверка: заморозка 2c применена; нет незамороженных заказов со скидкой в ручной корректировке (иначе автопересчёт добавил бы вторую скидку).
do $$
declare pl uuid; r jsonb;
begin
  if not exists (select 1 from equipment_bundle_steps where step = 'freeze_2c') then
    raise exception 'bundle freeze not applied' using errcode = '55000';
  end if;
  for pl in select distinct player_id from equipment_orders where legacy_bundle_id is null and manual_adjustment < 0 and player_id is not null loop
    r := eq_bundle_run(pl, 'manual', false, 'check');
    if r->>'state' = 'active' then
      raise exception 'unfrozen legacy discount: player %', pl using errcode = '55000';
    end if;
  end loop;
end $$;

-- 1. Запуск расчёта: пятый параметр restore_o нужен предпросмотру восстановления (заказ считается действующим, ничего не пишется).
create or replace function eq_bundle_run(p uuid, mode text, do_apply boolean, why text, restore_o uuid, expect text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fp text; c uuid; uid uuid := current_user_id();
  who text := (select display_name from users where id = current_user_id());
  inp jsonb; out jsonb; run_id bigint;
  st equipment_bundle_status; ab equipment_bundles; nb uuid;
  o record; new_adj numeric; new_total numeric; new_state text;
  changed boolean := false; same boolean; rev_reason text; closing uuid;
  rows jsonb := '[]'::jsonb; over numeric := 0; tie boolean;
  m_ids text; a_ids text; had_st boolean;
begin
  if restore_o is not null and do_apply then raise exception 'restore preview cannot be applied' using errcode = '22023'; end if;
  select club_id into c from players where id = p for update;
  if c is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  perform 1 from equipment_orders where player_id = p order by id for update;

  select * into st from equipment_bundle_status where player_id = p;
  had_st := found;
  if mode = 'auto' and had_st and st.state = 'unchecked' then
    -- Состояние «не проверено» автоматика не снимает; новые и правленные заказы получают метку «скидка не проверена» (Н8).
    perform set_config('eq.op', 'recalc', true);
    update equipment_orders set discount_state = 'unchecked' where player_id = p and discount_state is distinct from 'unchecked' and legacy_bundle_id is null;
    perform set_config('eq.op', '', true);
    return jsonb_build_object('skipped', 'unchecked');
  end if;

  inp := jsonb_build_object(
    'settings', jsonb_build_object('pct', eq_bundle_setting(c, 'equip.discPct'), 'round', eq_bundle_setting(c, 'equip.discRound'),
      'need_own', eq_bundle_setting(c, 'equip.discNeedOwn'), 'need_all', eq_bundle_setting(c, 'equip.discNeedAll'), 'full', eq_bundle_setting(c, 'equip.fullPrice')),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'status', case when e.id = restore_o then coalesce(e.status_before_cancel, 'accepted') else e.status end, 'created_at', e.created_at, 'ordered_on', e.ordered_on,
        'forfeited', e.discount_forfeited, 'frozen', e.legacy_bundle_id is not null) order by e.id) from equipment_orders e where e.player_id = p), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'order_id', l.order_id, 'kit', l.kit, 'quantity', l.quantity, 'unit_price', l.unit_price) order by l.id)
        from equipment_order_lines l join equipment_orders e on e.id = l.order_id where e.player_id = p), '[]'::jsonb));
  out := eq_bundle_calc(inp);
  -- Отпечаток предпросмотра: входные данные расчёта, суммы и оплаты заказов и результат. Подтверждение привязано к нему (expect):
  -- если между предпросмотром и применением что-то изменилось, применение отклоняется, не меняя ничего.
  fp := md5(inp::text || '|' || coalesce(restore_o::text, '') || '|' || out::text || '|' ||
    (select coalesce(string_agg(concat_ws(',', e.id, e.total, e.paid, e.manual_adjustment, e.bundle_adjustment, coalesce(e.discount_state, ''), e.status,
       coalesce(e.status_before_cancel, ''), e.discount_forfeited::text, coalesce(e.legacy_bundle_id::text, '')), ';' order by e.id), '') from equipment_orders e where e.player_id = p));
  if do_apply and expect is not null and fp is distinct from expect then
    raise exception 'preview changed' using errcode = '40001';
  end if;
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
      if (case when o.id = restore_o then 'active' else o.status end) <> 'cancelled' then over := over + greatest(o.paid - o.total, 0); end if;
      continue;
    end if;
    new_adj := case when out->>'state' = 'active' and o.id = closing then -(out->>'discount')::numeric else 0 end;
    new_total := eq_order_lines_sum(o.id) + o.manual_adjustment + new_adj;
    rows := rows || jsonb_build_object('order_id', o.id, 'total_before', o.total, 'total_after', new_total, 'bundle_before', o.bundle_adjustment, 'bundle_after', new_adj,
                                       'paid', o.paid, 'cancelled', (case when o.id = restore_o then 'active' else o.status end) = 'cancelled');
    if (case when o.id = restore_o then 'active' else o.status end) <> 'cancelled' then over := over + greatest(o.paid - new_total, 0); end if;
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
    'run_id', run_id, 'blocking', out->'blocking', 'fingerprint', fp);
end $$;
revoke execute on function eq_bundle_run(uuid, text, boolean, text, uuid, text) from public, anon, authenticated;

-- Пятиаргументная форма (без отпечатка) сохранена: на неё ссылается preflight и автоматика.
create or replace function eq_bundle_run(p uuid, mode text, do_apply boolean, why text, restore_o uuid) returns jsonb
language sql security definer set search_path = public as $$ select eq_bundle_run(p, mode, do_apply, why, restore_o, null::text) $$;
revoke execute on function eq_bundle_run(uuid, text, boolean, text, uuid) from public, anon, authenticated;

-- Четырёхаргументная форма сохранена (проверка preflight 0205 и ручной пересчёт 2a).
create or replace function eq_bundle_run(p uuid, mode text, do_apply boolean, why text) returns jsonb
language sql security definer set search_path = public as $$ select eq_bundle_run(p, mode, do_apply, why, null::uuid) $$;
revoke execute on function eq_bundle_run(uuid, text, boolean, text) from public, anon, authenticated;

-- 2. Автоматический пересчёт: только внутри функций eq_*, с предохранителем.
create or replace function eq_bundle_auto(p uuid, why text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p is null then return; end if;
  perform eq_bundle_assert_ready();
  perform eq_bundle_run(p, 'auto', true, why, null::uuid);
end $$;
revoke execute on function eq_bundle_auto(uuid, text) from public, anon, authenticated;

-- Единый порядок блокировок: сначала ребёнок, потом заказы. Возвращает ребёнка заказа (null, если у заказа нет игрока).
create or replace function eq_lock_player_of_order(o uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; found_o boolean;
begin
  select player_id, true into pid, found_o from equipment_orders where id = o;
  if found_o is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if pid is not null then perform 1 from players where id = pid for update; end if;
  return pid;
end $$;
revoke execute on function eq_lock_player_of_order(uuid) from public, anon, authenticated;

-- Отказ от скидки при выборе рассрочки (необратим автоматически, событие forfeit).
create or replace function eq_forfeit_mark(o uuid, why text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := current_user_id(); who text := (select display_name from users where id = current_user_id());
begin
  if exists (select 1 from equipment_orders where id = o and not discount_forfeited) then
    perform set_config('eq.op', 'forfeit', true);
    update equipment_orders set discount_forfeited = true where id = o;
    perform set_config('eq.op', '', true);
    insert into equipment_order_events (order_id, event, reason, data, created_by, created_by_name)
    values (o, 'forfeit', why, jsonb_build_object('installment', true), uid, who);
  end if;
end $$;
revoke execute on function eq_forfeit_mark(uuid, text) from public, anon, authenticated;

-- 3. Создание заказа (тело 0203): ребёнок блокируется первым, рассрочка ставит отказ, в конце автопересчёт.
create or replace function eq_create_order(p uuid, lines jsonb, insc text, num text, inst boolean, loc text, custom_total numeric default null, req uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c uuid; oid uuid; l jsonb; pr numeric; tot numeric := 0; q int;
  uid uuid := current_user_id();
  norm jsonb := '[]'::jsonb;
  ex equipment_orders;
begin
  perform eq_assert_admin();
  select club_id into c from players where id = p for update;
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
    -- Один и тот же ключ одного автора обрабатывается по очереди: второй вызов ждёт первого и видит его заказ (без пересчёта, Б6).
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
  perform eq_bundle_assert_ready();

  insert into equipment_orders (club_id, player_id, ordered_on, inscription, number, installment, total, paid, location, request_id, discount_forfeited)
  values (c, p, current_date, nullif(trim(insc), ''), nullif(trim(num), ''), coalesce(inst, false), 0, 0, nullif(trim(loc), ''), req, coalesce(inst, false)) returning id into oid;
  for l in select * from jsonb_array_elements(norm) loop
    pr := eq_price(c, l->>0, current_date);
    if pr is null then raise exception 'kit not in catalog' using errcode = '22023'; end if;
    q := (l->>2)::int;
    insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values (oid, l->>0, nullif(l->>1, ''), q, pr);
    tot := tot + pr * q;
  end loop;
  update equipment_orders set total = coalesce(custom_total, tot) where id = oid;
  perform eq_bundle_auto(p, 'create');
  return oid;
end $$;
revoke execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric, uuid) from public, anon;
grant execute on function eq_create_order(uuid, jsonb, text, text, boolean, text, numeric, uuid) to authenticated;

-- 4. Правка заказа (тело 0205): рассрочка ставит отказ, затем автопересчёт.
create or replace function eq_edit_order(o uuid, insc text, num text, inst boolean, loc text, new_total numeric) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  perform eq_assert_admin();
  pid := eq_lock_player_of_order(o);
  perform 1 from equipment_orders where id = o for update;
  if new_total is null or new_total < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if pid is not null then perform eq_bundle_assert_ready(); end if;
  update equipment_orders set inscription = nullif(trim(insc), ''), number = nullif(trim(num), ''), installment = coalesce(inst, false),
    location = nullif(trim(loc), ''), total = new_total where id = o;
  if coalesce(inst, false) then perform eq_forfeit_mark(o, 'installment'); end if;
  perform eq_bundle_auto(pid, 'edit');
end $$;
revoke execute on function eq_edit_order(uuid, text, text, boolean, text, numeric) from public, anon;
grant execute on function eq_edit_order(uuid, text, text, boolean, text, numeric) to authenticated;

-- 5. Строки (тела 0205 и 0125): ребёнок, потом заказ, в конце автопересчёт.
create or replace function eq_edit_line(l uuid, sz text, qty int) returns void
language plpgsql security definer set search_path = public as $$
declare ln equipment_order_lines; eo equipment_orders; delta numeric; pid uuid; oid uuid;
begin
  perform eq_assert_admin();
  select order_id into oid from equipment_order_lines where id = l;
  if oid is null then raise exception 'line not found' using errcode = 'P0002'; end if;
  pid := eq_lock_player_of_order(oid);
  select * into eo from equipment_orders where id = oid for update;
  select * into ln from equipment_order_lines where id = l;
  if not found then raise exception 'line not found' using errcode = 'P0002'; end if;
  if qty is null or qty < 1 or qty > 10 then raise exception 'bad quantity' using errcode = '22023'; end if;
  if pid is not null then perform eq_bundle_assert_ready(); end if;
  delta := 0;
  if qty <> ln.quantity then
    if exists (select 1 from equipment_issues where order_id = ln.order_id and kit = ln.kit) then raise exception 'item issued' using errcode = '22023'; end if;
    delta := ln.unit_price * (qty - ln.quantity);
  end if;
  update equipment_order_lines set size = nullif(trim(sz), ''), quantity = qty where id = l;
  if delta <> 0 then update equipment_orders set total = total + delta where id = eo.id; end if;
  perform eq_bundle_auto(pid, 'edit');
end $$;

create or replace function eq_add_line(o uuid, k text, sz text, qty int default 1) returns uuid
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; pr numeric; lid uuid; pid uuid;
begin
  perform eq_assert_admin();
  pid := eq_lock_player_of_order(o);
  select * into eo from equipment_orders where id = o for update;
  if qty is null or qty < 1 or qty > 10 then raise exception 'bad quantity' using errcode = '22023'; end if;
  if exists (select 1 from equipment_issues where order_id = o and kit = k) then raise exception 'item issued' using errcode = '22023'; end if;
  pr := eq_price(eo.club_id, k, current_date);
  if pr is null then raise exception 'kit not in catalog' using errcode = '22023'; end if;
  if pid is not null then perform eq_bundle_assert_ready(); end if;
  insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values (o, k, nullif(trim(sz), ''), qty, pr) returning id into lid;
  update equipment_orders set total = total + pr * qty where id = o;
  perform eq_bundle_auto(pid, 'edit');
  return lid;
end $$;

create or replace function eq_delete_line(l uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ln equipment_order_lines; eo equipment_orders; amt numeric; pid uuid; oid uuid;
begin
  perform eq_assert_admin();
  select order_id into oid from equipment_order_lines where id = l;
  if oid is null then raise exception 'line not found' using errcode = 'P0002'; end if;
  pid := eq_lock_player_of_order(oid);
  select * into eo from equipment_orders where id = oid for update;
  select * into ln from equipment_order_lines where id = l;
  if not found then raise exception 'line not found' using errcode = 'P0002'; end if;
  if exists (select 1 from equipment_issues where order_id = ln.order_id and kit = ln.kit) then raise exception 'item issued' using errcode = '22023'; end if;
  if (select count(*) from equipment_order_lines where order_id = ln.order_id) <= 1 then raise exception 'last line' using errcode = '22023'; end if;
  if pid is not null then perform eq_bundle_assert_ready(); end if;
  amt := ln.unit_price * ln.quantity;
  delete from equipment_order_lines where id = l;
  update equipment_orders set total = total - amt where id = eo.id;
  perform eq_bundle_auto(pid, 'edit');
end $$;

-- Дата заказа влияет на порядок (замыкающий заказ): после неё тоже пересчёт.
create or replace function eq_set_order_date(o uuid, d date) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  perform eq_assert_admin();
  if d is null or d > current_date then raise exception 'bad date' using errcode = '22023'; end if;
  pid := eq_lock_player_of_order(o);
  perform 1 from equipment_orders where id = o for update;
  if pid is not null then perform eq_bundle_assert_ready(); end if;
  update equipment_orders set ordered_on = d where id = o;
  perform eq_bundle_auto(pid, 'edit');
end $$;

-- Удаление заказа (тело 0185): после него пересчёт.
create or replace function eq_delete_order(o uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  perform eq_assert_admin();
  pid := eq_lock_player_of_order(o);
  -- Порядок блокировок «игрок, затем заказ». Заказ блокируем до проверок: параллельная оплата (eq_add_payment) держит блокировку заказа,
  -- и после её завершения проверки ниже видят уже оплаченный заказ, а не устаревшее состояние.
  perform 1 from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if exists (select 1 from equipment_orders where id = o and source = 'parent') then raise exception 'parent order' using errcode = '22023'; end if;
  if exists (select 1 from equipment_order_events where order_id = o) then raise exception 'order has events' using errcode = '22023'; end if;
  if exists (select 1 from equipment_orders where id = o and paid > 0) then raise exception 'order has payments' using errcode = '22023'; end if;
  if exists (select 1 from equipment_issues where order_id = o) then raise exception 'order has issues' using errcode = '22023'; end if;
  if pid is not null then perform eq_bundle_assert_ready(); end if;
  delete from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  perform eq_bundle_auto(pid, 'edit');
end $$;

-- 6. Отмена (тело 0185): после отмены пересчёт.
create or replace function eq_cancel_order(o uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  eo equipment_orders; pid uuid;
  uid uuid := current_user_id();
  who text := (select display_name from users where id = current_user_id());
begin
  perform eq_assert_admin();
  pid := eq_lock_player_of_order(o);
  select * into eo from equipment_orders where id = o for update;
  if eo.status = 'cancelled' then raise exception 'already cancelled' using errcode = '22023'; end if;
  if nullif(trim(reason), '') is null then raise exception 'reason required' using errcode = '22023'; end if;
  if pid is not null then perform eq_bundle_assert_ready(); end if;
  perform set_config('eq.op', 'cancel', true);
  update equipment_orders
     set status = 'cancelled', status_before_cancel = eo.status, cancelled_at = now(), cancelled_by = uid, cancel_reason = trim(reason)
   where id = o;
  perform set_config('eq.op', '', true);
  insert into equipment_order_status_history (order_id, status, changed_by, changed_by_name) values (o, 'cancelled', uid, who);
  insert into equipment_order_events (order_id, event, reason, data, created_by, created_by_name)
  values (o, 'cancel', trim(reason),
          jsonb_build_object('from_status', eo.status, 'to_status', 'cancelled', 'paid', eo.paid, 'total', eo.total), uid, who);
  perform eq_bundle_auto(pid, 'cancel');
end $$;

-- Ручной пересчёт с подтверждением предпросмотра: третий параметр — fingerprint из eq_bundle_preview. Без него или при расхождении ничего не меняется.
create or replace function eq_bundle_recalc(p uuid, mode text, expect text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pv jsonb;
begin
  perform eq_assert_admin();
  if mode is distinct from 'manual' then raise exception 'bad mode' using errcode = '22023'; end if;
  perform eq_bundle_assert_ready();
  if expect is null then
    pv := eq_bundle_run(p, 'manual', false, 'manual');
    raise exception 'confirm required' using errcode = '22023', detail = pv::text;
  end if;
  return eq_bundle_run(p, 'manual', true, 'manual', null::uuid, expect);
end $$;
revoke execute on function eq_bundle_recalc(uuid, text, text) from public, anon;
grant execute on function eq_bundle_recalc(uuid, text, text) to authenticated;

-- Двухаргументная форма из 0205 больше не применяет пересчёт: без отпечатка предпросмотра она только отвечает «confirm required» (или прежней ошибкой доступа и проверок).
-- Права сохранены (на них опирается preflight 0205), обхода подтверждения у роли authenticated нет.
create or replace function eq_bundle_recalc(p uuid, mode text default 'manual') returns jsonb
language sql security definer set search_path = public as $$ select eq_bundle_recalc(p, mode, null::text) $$;

-- 7. Восстановление (Q6): только с подтверждением; предпросмотр отдельной функцией.
create or replace function eq_restore_preview(o uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid; st text;
begin
  perform eq_assert_admin();
  select player_id, status into pid, st from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if st <> 'cancelled' then raise exception 'not cancelled' using errcode = '22023'; end if;
  perform eq_bundle_assert_ready();
  if pid is null then return jsonb_build_object('state', 'none', 'reason', 'not_complete', 'changed', false, 'orders', '[]'::jsonb, 'overpaid', 0, 'fingerprint', 'none'); end if;
  return eq_bundle_run(pid, 'manual', false, 'restore', o);
end $$;

create or replace function eq_restore_order(o uuid, note text, expect text) returns void
language plpgsql security definer set search_path = public as $$
declare
  eo equipment_orders; pid uuid; pv jsonb;
  uid uuid := current_user_id();
  who text := (select display_name from users where id = current_user_id());
begin
  perform eq_assert_admin();
  if expect is null then
    pv := eq_restore_preview(o);
    raise exception 'confirm required' using errcode = '22023', detail = pv::text;
  end if;
  pid := eq_lock_player_of_order(o);
  select * into eo from equipment_orders where id = o for update;
  if eo.status <> 'cancelled' then raise exception 'not cancelled' using errcode = '22023'; end if;
  if pid is not null then
    perform eq_bundle_assert_ready();
    -- подтверждение привязано к показанному предпросмотру: под теми же блокировками считаем отпечаток заново
    if expect is distinct from (eq_bundle_run(pid, 'manual', false, 'restore', o, null::text))->>'fingerprint' then
      raise exception 'preview changed' using errcode = '40001';
    end if;
  elsif expect is distinct from 'none' then
    raise exception 'preview changed' using errcode = '40001';
  end if;
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
  perform eq_bundle_auto(pid, 'restore');
end $$;

-- Прежняя форма без подтверждения: всегда отвечает «confirm required» с предпросмотром (проверка preflight 0185 и защита старых клиентов).
create or replace function eq_restore_order(o uuid, note text) returns void
language sql security definer set search_path = public as $$ select eq_restore_order(o, note, null::text) $$;

-- 8. Порядок блокировок оплат (замечание ревью PR #738): игрок, затем заказ, как у удаления, отмены и пересчёта. Иначе оплата (заказ, затем KEY SHARE
-- игрока по внешнему ключу журнала) и удаление (игрок, затем заказ) могли взаимно заблокироваться. Тела из 0188 без других изменений.
create or replace function eq_add_payment(o uuid, amt numeric, d date default null, mth text default null, req uuid default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; ex service_payments; uid uuid := current_user_id();
begin
  if not (is_admin() or has_location_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform eq_lock_player_of_order(o);  -- порядок блокировок «игрок, затем заказ», как у остальных операций над заказом (0208)
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not is_admin() and not is_location_admin(eo.location) then raise exception 'forbidden' using errcode = '42501'; end if;
  if amt is null or amt = 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if amt < 0 then raise exception 'use reversal or refund' using errcode = '22023'; end if;
  if req is not null then
    select * into ex from service_payments where recorded_by = uid and request_id = req;
    if found then
      if ex.kind = 'equipment' and ex.ref_id = o and ex.amount = amt and ex.op = 'payment' then return eo.paid; end if;
      raise exception 'request id reused' using errcode = '22023';
    end if;
  end if;
  if eo.status = 'cancelled' then raise exception 'order cancelled' using errcode = '22023'; end if;
  if d is not null and d > tbilisi_day(now()) then raise exception 'bad date' using errcode = '22023'; end if;
  perform service_method_ok(mth);
  if eo.paid + amt > eo.total then raise exception 'paid above total' using errcode = '22023'; end if;
  insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id)
  values ('equipment', o, eo.player_id, amt, coalesce(d, tbilisi_day(now())), trim(mth), 'payment', req);
  return (select paid from equipment_orders where id = o);
end $$;

create or replace function eq_reverse_payment(pid uuid, note text, req uuid default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare orig service_payments; eo equipment_orders; ex service_payments; uid uuid := current_user_id();
begin
  perform eq_assert_admin();
  select * into orig from service_payments where id = pid;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if orig.kind <> 'equipment' or orig.op <> 'payment' then raise exception 'not a payment' using errcode = '22023'; end if;
  perform eq_lock_player_of_order(orig.ref_id);
  select * into eo from equipment_orders where id = orig.ref_id for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if req is not null then
    select * into ex from service_payments where recorded_by = uid and request_id = req;
    if found then
      if ex.cancels = pid then return eo.paid; end if;
      raise exception 'request id reused' using errcode = '22023';
    end if;
  end if;
  if nullif(trim(note), '') is null then raise exception 'note required' using errcode = '22023'; end if;
  if exists (select 1 from service_payments where cancels = pid) then raise exception 'already reversed' using errcode = '22023'; end if;
  if eo.paid - orig.amount < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, cancels, op, note, request_id)
  values ('equipment', orig.ref_id, orig.player_id, -orig.amount, tbilisi_day(now()), orig.method, pid, 'reversal', trim(note), req);
  return (select paid from equipment_orders where id = orig.ref_id);
end $$;

create or replace function eq_refund(o uuid, amt numeric, d date default null, mth text default null, note text default null, req uuid default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; ex service_payments; uid uuid := current_user_id();
begin
  perform eq_assert_admin();
  perform eq_lock_player_of_order(o);
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if amt is null or amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if req is not null then
    select * into ex from service_payments where recorded_by = uid and request_id = req;
    if found then
      if ex.kind = 'equipment' and ex.ref_id = o and ex.amount = -amt and ex.op = 'refund' then return eo.paid; end if;
      raise exception 'request id reused' using errcode = '22023';
    end if;
  end if;
  if nullif(trim(note), '') is null then raise exception 'note required' using errcode = '22023'; end if;
  if d is not null and d > tbilisi_day(now()) then raise exception 'bad date' using errcode = '22023'; end if;
  perform service_method_ok(mth);
  if amt > eo.paid then raise exception 'refund above paid' using errcode = '22023'; end if;
  insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, note, request_id)
  values ('equipment', o, eo.player_id, -amt, coalesce(d, tbilisi_day(now())), trim(mth), 'refund', trim(note), req);
  return (select paid from equipment_orders where id = o);
end $$;

revoke execute on function eq_restore_order(uuid, text), eq_restore_order(uuid, text, text), eq_restore_preview(uuid) from public, anon;
grant execute on function eq_restore_order(uuid, text), eq_restore_order(uuid, text, text), eq_restore_preview(uuid) to authenticated;
revoke execute on function eq_edit_line(uuid, text, int), eq_add_line(uuid, text, text, int), eq_delete_line(uuid), eq_set_order_date(uuid, date),
  eq_delete_order(uuid), eq_cancel_order(uuid, text) from public, anon;
grant execute on function eq_edit_line(uuid, text, int), eq_add_line(uuid, text, text, int), eq_delete_line(uuid), eq_set_order_date(uuid, date),
  eq_delete_order(uuid), eq_cancel_order(uuid, text) to authenticated;
