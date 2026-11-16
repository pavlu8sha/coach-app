-- #652, этап 2a: модель и серверный расчёт скидки за комплект экипировки (план v5 п. 2).
-- Условия: docs/acceptance/eq-652-stage2-bundle-discount-2026-11-16.md (А1–А14, И1–И7).
-- Расчёт НЕ подключён к созданию, правке, отмене и восстановлению (это 2b, миграция 0207). Применять строго 0205 -> 0206 (заморозка) -> 0207.
-- Платёжный журнал и paid расчётом не затрагиваются.

-- 1. Поля заказа
alter table equipment_orders
  add column if not exists discount_forfeited boolean not null default false,
  add column if not exists manual_adjustment numeric not null default 0,
  add column if not exists bundle_adjustment numeric not null default 0,
  add column if not exists discount_state text,
  add column if not exists legacy_bundle_id uuid;
alter table equipment_orders drop constraint if exists equipment_orders_bundle_adjustment_check;
alter table equipment_orders add constraint equipment_orders_bundle_adjustment_check check (bundle_adjustment <= 0);
alter table equipment_orders drop constraint if exists equipment_orders_discount_state_check;
alter table equipment_orders add constraint equipment_orders_discount_state_check check (discount_state is null or discount_state in ('ok', 'unchecked'));

-- 2. Таблицы (только добавление записей)
create table if not exists equipment_legacy_bundles (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id),
  kind text not null check (kind in ('confirmed', 'review')),
  reason text,
  calc_discount numeric,
  created_at timestamptz not null default now(),
  created_by uuid,
  released_at timestamptz,
  released_by uuid,
  released_note text
);
create index if not exists equipment_legacy_bundles_player_idx on equipment_legacy_bundles (player_id);
alter table equipment_orders drop constraint if exists equipment_orders_legacy_bundle_fk;
alter table equipment_orders add constraint equipment_orders_legacy_bundle_fk foreign key (legacy_bundle_id) references equipment_legacy_bundles(id);

create table if not exists equipment_bundles (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id),
  closing_order_id uuid not null references equipment_orders(id),
  members jsonb not null,
  base numeric not null,
  pct numeric not null,
  round_to numeric not null,
  discount numeric not null check (discount > 0),
  state text not null default 'active' check (state in ('active', 'revoked')),
  created_reason text not null check (created_reason in ('create', 'edit', 'cancel', 'restore', 'manual')),
  created_at timestamptz not null default now(),
  created_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text check (revoked_reason is null or revoked_reason in
    ('closing_order_cancelled', 'member_order_cancelled', 'composition_changed', 'forfeited_order', 'need_all_failed', 'settings_invalid', 'restore_recalc', 'manual')),
  check ((state = 'revoked') = (revoked_at is not null and revoked_reason is not null))
);
create unique index if not exists equipment_bundles_one_active on equipment_bundles (player_id) where state = 'active';
create index if not exists equipment_bundles_player_idx on equipment_bundles (player_id, created_at);

create table if not exists equipment_bundle_runs (
  id bigint generated always as identity primary key,
  player_id uuid not null references players(id),
  mode text not null check (mode in ('auto', 'manual')),
  trigger_reason text not null,
  input jsonb not null,
  output jsonb not null,
  tie_break_id boolean not null default false,
  applied boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists equipment_bundle_runs_player_idx on equipment_bundle_runs (player_id, id);

create table if not exists equipment_bundle_status (
  player_id uuid primary key references players(id),
  state text not null check (state in ('none', 'active', 'unchecked')),
  reason text not null,
  reason_detail text,
  bundle_id uuid references equipment_bundles(id),
  checked_at timestamptz not null default now(),
  checked_by uuid,
  last_run_id bigint references equipment_bundle_runs(id)
);

-- Отметки применённых шагов (2c ставит freeze_2c; без неё расчёт отказывается работать).
create table if not exists equipment_bundle_steps (
  step text primary key,
  applied_at timestamptz not null default now(),
  note text
);

create or replace function eq_bundles_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'equipment_bundles' then
    if old.state = 'active' and new.state = 'revoked'
       and (to_jsonb(new) - 'state' - 'revoked_at' - 'revoked_by' - 'revoked_reason') = (to_jsonb(old) - 'state' - 'revoked_at' - 'revoked_by' - 'revoked_reason') then
      return new;
    end if;
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'equipment_legacy_bundles' then
    if (to_jsonb(old)->>'released_at') is null and (to_jsonb(new)->>'released_at') is not null
       and (to_jsonb(new) - 'released_at' - 'released_by' - 'released_note') = (to_jsonb(old) - 'released_at' - 'released_by' - 'released_note') then
      return new;
    end if;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
revoke execute on function eq_bundles_guard() from public, anon, authenticated;
create or replace function eq_runs_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
revoke execute on function eq_runs_append_only() from public, anon, authenticated;

drop trigger if exists equipment_bundles_guard on equipment_bundles;
create trigger equipment_bundles_guard before update or delete on equipment_bundles for each row execute function eq_bundles_guard();
drop trigger if exists equipment_legacy_bundles_guard on equipment_legacy_bundles;
create trigger equipment_legacy_bundles_guard before update or delete on equipment_legacy_bundles for each row execute function eq_bundles_guard();
drop trigger if exists equipment_bundle_runs_guard on equipment_bundle_runs;
create trigger equipment_bundle_runs_guard before update or delete on equipment_bundle_runs for each row execute function eq_runs_append_only();
drop trigger if exists equipment_bundle_steps_guard on equipment_bundle_steps;
create trigger equipment_bundle_steps_guard before update or delete on equipment_bundle_steps for each row execute function eq_runs_append_only();
drop trigger if exists equipment_bundles_no_truncate on equipment_bundles;
create trigger equipment_bundles_no_truncate before truncate on equipment_bundles for each statement execute function eq_runs_append_only();
drop trigger if exists equipment_bundle_steps_no_truncate on equipment_bundle_steps;
create trigger equipment_bundle_steps_no_truncate before truncate on equipment_bundle_steps for each statement execute function eq_runs_append_only();
drop trigger if exists equipment_bundle_runs_no_truncate on equipment_bundle_runs;
create trigger equipment_bundle_runs_no_truncate before truncate on equipment_bundle_runs for each statement execute function eq_runs_append_only();

do $$
declare t text;
begin
  foreach t in array array['equipment_bundles', 'equipment_bundle_runs', 'equipment_bundle_status', 'equipment_bundle_steps', 'equipment_legacy_bundles'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (is_admin())', t || '_read', t);
    execute format('revoke all on %I from public, anon, authenticated, service_role', t);
    execute format('grant select on %I to authenticated, service_role', t);
  end loop;
end $$;

-- 3. События заказа: новые виды
alter table equipment_order_events drop constraint if exists equipment_order_events_event_check;
alter table equipment_order_events add constraint equipment_order_events_event_check
  check (event in ('cancel', 'restore', 'recalc', 'forfeit', 'forfeit_reset'));

-- 4. Защита заказа (тело 0188). Новое: прямая запись полей скидки закрыта; при пересчёте (eq.op = 'recalc')
-- у отменённого заказа меняются только bundle_adjustment, total и discount_state (А10).
create or replace function eq_orders_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  op text := coalesce(current_setting('eq.op', true), '');
begin
  if tg_op = 'INSERT' then
    new.created_by := current_user_id();
    if new.created_by is not null then new.created_at := now(); end if;
    if new.external_ord_id is not null and new.source = 'admin' then new.source := 'import'; end if;
    if new.status = 'cancelled' or new.cancelled_at is not null or new.status_before_cancel is not null then
      raise exception 'use eq_cancel_order / eq_restore_order' using errcode = '42501';
    end if;
    if new.bundle_adjustment <> 0 or new.legacy_bundle_id is not null then
      raise exception 'discount fields are managed by eq_bundle_recalc' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by
     or new.source is distinct from old.source or new.request_id is distinct from old.request_id then
    raise exception 'created fields are immutable' using errcode = '42501';
  end if;
  if op not in ('cancel', 'restore') and (
       (new.status = 'cancelled') <> (old.status = 'cancelled')
       or new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by
       or new.cancel_reason is distinct from old.cancel_reason or new.status_before_cancel is distinct from old.status_before_cancel
       or new.restored_at is distinct from old.restored_at or new.restored_by is distinct from old.restored_by) then
    raise exception 'use eq_cancel_order / eq_restore_order' using errcode = '42501';
  end if;
  if op not in ('recalc', 'forfeit') and (
       new.bundle_adjustment is distinct from old.bundle_adjustment or new.discount_forfeited is distinct from old.discount_forfeited
       or new.legacy_bundle_id is distinct from old.legacy_bundle_id or new.discount_state is distinct from old.discount_state) then
    raise exception 'discount fields are managed by eq_bundle_recalc' using errcode = '42501';
  end if;
  if old.status = 'cancelled' and new.status = 'cancelled' then
    if new.paid > old.paid or
       (to_jsonb(new) - 'paid' - case when op = 'recalc' then array['total', 'bundle_adjustment', 'discount_state'] else array[]::text[] end)
         is distinct from
       (to_jsonb(old) - 'paid' - case when op = 'recalc' then array['total', 'bundle_adjustment', 'discount_state'] else array[]::text[] end) then
      raise exception 'order cancelled' using errcode = '22023';
    end if;
  end if;
  if new.paid is distinct from old.paid then
    if coalesce(current_setting('eq.paid_sync', true), '') <> 'on' then
      raise exception 'paid is maintained by the journal' using errcode = '42501';
    end if;
    if new.paid < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
revoke execute on function eq_orders_guard() from public, anon, authenticated;

-- 5. Итог = строки + ручная корректировка + скидка комплекта (И4). Правка total или manual_adjustment вне расчёта
-- сохраняет равенство: расхождение уходит в manual_adjustment. Триггер срабатывает после eq_orders_guard (имя по алфавиту).
create or replace function eq_order_lines_sum(o uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(coalesce(unit_price, 0) * quantity), 0) from equipment_order_lines where order_id = o
$$;
revoke execute on function eq_order_lines_sum(uuid) from public, anon, authenticated;

create or replace function eq_orders_zresidual() returns trigger
language plpgsql set search_path = public as $$
declare ls numeric;
begin
  if coalesce(current_setting('eq.op', true), '') in ('recalc', 'backfill') then return new; end if;
  ls := eq_order_lines_sum(new.id);
  if new.total is distinct from old.total then
    new.manual_adjustment := new.total - ls - new.bundle_adjustment;
  elsif new.manual_adjustment is distinct from old.manual_adjustment then
    new.total := ls + new.manual_adjustment + new.bundle_adjustment;
  end if;
  return new;
end $$;
revoke execute on function eq_orders_zresidual() from public, anon, authenticated;
drop trigger if exists equipment_orders_zresidual on equipment_orders;
create trigger equipment_orders_zresidual before update of total, manual_adjustment on equipment_orders
  for each row execute function eq_orders_zresidual();

-- 6. Заполнение manual_adjustment у существующих заказов: итог не меняется (И4). Защита отменённого заказа на время заполнения снята.
alter table equipment_orders disable trigger equipment_orders_guard;
select set_config('eq.op', 'backfill', true);
update equipment_orders o set manual_adjustment = o.total - eq_order_lines_sum(o.id) - o.bundle_adjustment
 where o.manual_adjustment <> o.total - eq_order_lines_sum(o.id) - o.bundle_adjustment;
select set_config('eq.op', '', true);
alter table equipment_orders enable trigger equipment_orders_guard;

-- 7. Настройки скидки (значения по умолчанию как в web/src/lib/clubSettings.ts; тест паритета).
create or replace function eq_bundle_setting(c uuid, k text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(trim(value), '') from club_settings where club_id = c and key = k and scope = ''),
    case k
      when 'equip.fullPrice' then 'Носки, Гетры'
      when 'equip.discNeedOwn' then 'Игровая форма или Вратарская форма, Тренировочная форма, Спортивный костюм, Дождевик'
      when 'equip.discNeedAll' then 'Игровая форма или Вратарская форма или Тренировочная форма или Спортивный костюм или Дождевик'
      when 'equip.discPct' then '15'
      when 'equip.discRound' then '5'
    end)
$$;
revoke execute on function eq_bundle_setting(uuid, text) from public, anon, authenticated;

-- «A или B, C» -> [["a","b"],["c"]]
create or replace function eq_bundle_rule(s text) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(g order by n), '[]'::jsonb) from (
    select n, (select coalesce(jsonb_agg(trim(x)) filter (where trim(x) <> ''), '[]'::jsonb) from regexp_split_to_table(lower(trim(grp)), '\s+или\s+') x) as g
    from regexp_split_to_table(coalesce(s, ''), ',') with ordinality as t(grp, n)
  ) q where jsonb_array_length(g) > 0
$$;
revoke execute on function eq_bundle_rule(text) from public, anon, authenticated;

create or replace function eq_bundle_rule_ok(rule jsonb, have text[]) returns boolean
language sql immutable set search_path = public as $$
  select jsonb_array_length(rule) > 0 and not exists (
    select 1 from jsonb_array_elements(rule) g where not exists (select 1 from jsonb_array_elements_text(g) k where k = any(have)))
$$;
revoke execute on function eq_bundle_rule_ok(jsonb, text[]) from public, anon, authenticated;

-- 8. Чистая функция расчёта (план v5, 2.2, 2.5, 2.9). Только входной jsonb, без обращений к таблицам.
-- Вход: {settings:{pct,round,need_own,need_all,full}, orders:[{id,status,created_at,ordered_on,forfeited,frozen}], lines:[{id,order_id,kit,quantity,unit_price}]}
create or replace function eq_bundle_calc(inp jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  s jsonb := inp->'settings';
  pct numeric; rnd numeric; v text;
  own jsonb; need jsonb; fullp text[];
  gi int; r record; first_r record; n_r int; used text[] := '{}';
  members jsonb := '[]'::jsonb; tie boolean := false;
  parts uuid[]; closing uuid; cl record; n_c int; kits text[];
  base numeric; res numeric; disc numeric; blocking jsonb;
  res_out jsonb;
begin
  -- настройки
  v := replace(coalesce(s->>'pct', ''), ',', '.');
  if v !~ '^\d+(\.\d+)?$' or v::numeric > 90 then
    return jsonb_build_object('state', 'unchecked', 'reason', 'settings_invalid', 'detail', 'equip.discPct: ' || coalesce(s->>'pct', ''), 'discount', 0, 'tie_break_id', false);
  end if;
  pct := v::numeric;
  v := replace(coalesce(s->>'round', ''), ',', '.');
  if v !~ '^\d+$' or v::numeric < 1 or v::numeric > 100 then
    return jsonb_build_object('state', 'unchecked', 'reason', 'settings_invalid', 'detail', 'equip.discRound: ' || coalesce(s->>'round', ''), 'discount', 0, 'tie_break_id', false);
  end if;
  rnd := v::numeric;
  own := eq_bundle_rule(s->>'need_own');
  if jsonb_array_length(own) = 0 then
    return jsonb_build_object('state', 'unchecked', 'reason', 'settings_invalid', 'detail', 'equip.discNeedOwn: ' || coalesce(s->>'need_own', ''), 'discount', 0, 'tie_break_id', false);
  end if;
  need := eq_bundle_rule(s->>'need_all');
  if jsonb_array_length(need) = 0 then
    return jsonb_build_object('state', 'unchecked', 'reason', 'settings_invalid', 'detail', 'equip.discNeedAll: ' || coalesce(s->>'need_all', ''), 'discount', 0, 'tie_break_id', false);
  end if;
  select coalesce(array_agg(lower(trim(x))), '{}') into fullp from regexp_split_to_table(coalesce(s->>'full', ''), ',') x where trim(x) <> '';
  if pct = 0 then
    return jsonb_build_object('state', 'none', 'reason', 'no_discount', 'discount', 0, 'pct', pct, 'round', rnd, 'tie_break_id', false);
  end if;

  -- члены комплекта: по каждой группе самая ранняя единица
  for gi in 0 .. jsonb_array_length(own) - 1 loop
    n_r := 0;
    for r in
      select l.id as line_id, l.order_id, l.kit, l.unit_price, o.created_at, o.ordered_on, u.n
        from jsonb_to_recordset(inp->'lines') as l(id uuid, order_id uuid, kit text, quantity int, unit_price numeric)
        join jsonb_to_recordset(inp->'orders') as o(id uuid, status text, created_at timestamptz, ordered_on date, forfeited boolean, frozen boolean) on o.id = l.order_id
        cross join lateral generate_series(1, l.quantity) as u(n)
       where o.status <> 'cancelled' and not coalesce(o.frozen, false)
         and lower(trim(l.kit)) in (select jsonb_array_elements_text(own -> gi))
         and not (lower(trim(l.kit)) = any (fullp))
         and (l.id::text || ':' || u.n) <> all (used)
       order by o.created_at, o.ordered_on nulls first, o.id, l.id, u.n
       limit 2
    loop
      n_r := n_r + 1;
      if n_r = 1 then
        first_r := r;
      elsif r.line_id <> first_r.line_id and r.created_at = first_r.created_at and r.ordered_on is not distinct from first_r.ordered_on then
        tie := true;
      end if;
    end loop;
    if n_r = 0 then
      return jsonb_build_object('state', 'none', 'reason', 'not_complete', 'discount', 0, 'pct', pct, 'round', rnd, 'tie_break_id', false);
    end if;
    used := used || (first_r.line_id::text || ':' || first_r.n);
    members := members || jsonb_build_object('group', gi, 'line_id', first_r.line_id, 'order_id', first_r.order_id, 'kit', first_r.kit, 'unit_price', coalesce(first_r.unit_price, 0));
  end loop;

  select array_agg(distinct (m->>'order_id')::uuid) into parts from jsonb_array_elements(members) m;

  -- замыкающий: участвующий заказ с наибольшим (created_at, ordered_on, id)
  n_c := 0;
  for r in
    select o.id, o.created_at, o.ordered_on
      from jsonb_to_recordset(inp->'orders') as o(id uuid, status text, created_at timestamptz, ordered_on date, forfeited boolean, frozen boolean)
     where o.id = any (parts)
     order by o.created_at desc, o.ordered_on desc nulls last, o.id desc
     limit 2
  loop
    n_c := n_c + 1;
    if n_c = 1 then cl := r; elsif r.created_at = cl.created_at and r.ordered_on is not distinct from cl.ordered_on then tie := true; end if;
  end loop;
  closing := cl.id;
  base := (select coalesce(sum((m->>'unit_price')::numeric), 0) from jsonb_array_elements(members) m);

  res_out := jsonb_build_object('closing_order_id', closing, 'members', members, 'participants', to_jsonb(parts), 'base', base, 'pct', pct, 'round', rnd, 'tie_break_id', tie);

  -- discNeedAll по строкам замыкающего заказа
  select coalesce(array_agg(distinct lower(trim(l.kit))), '{}') into kits
    from jsonb_to_recordset(inp->'lines') as l(id uuid, order_id uuid, kit text, quantity int, unit_price numeric) where l.order_id = closing;
  if not eq_bundle_rule_ok(need, kits) then
    return res_out || jsonb_build_object('state', 'none', 'reason', 'need_all_failed', 'discount', 0);
  end if;

  -- отказ от скидки (по заказу)
  select coalesce(jsonb_agg(o.id), '[]'::jsonb) into blocking
    from jsonb_to_recordset(inp->'orders') as o(id uuid, status text, created_at timestamptz, ordered_on date, forfeited boolean, frozen boolean)
   where o.id = any (parts) and coalesce(o.forfeited, false);
  if jsonb_array_length(blocking) > 0 then
    return res_out || jsonb_build_object('state', 'none', 'reason', 'forfeited_order', 'blocking', blocking, 'discount', 0);
  end if;

  res := greatest(floor(base * (1 - pct / 100) / rnd + 0.5) * rnd, 0);
  disc := base - res;
  if disc <= 0 then
    return res_out || jsonb_build_object('state', 'none', 'reason', 'no_discount', 'discount', 0);
  end if;
  return res_out || jsonb_build_object('state', 'active', 'reason', 'ok', 'discount', disc, 'rounded', res);
end $$;
revoke execute on function eq_bundle_calc(jsonb) from public, anon, authenticated;

-- 9. Запуск: сбор входных данных, расчёт, применение (внутренняя функция; вызывают eq_bundle_preview / eq_bundle_recalc и в 2b автоматика).
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

create or replace function eq_bundle_assert_ready() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from equipment_bundle_steps where step = 'freeze_2c') then
    raise exception 'bundle freeze not applied' using errcode = '55000';
  end if;
end $$;
revoke execute on function eq_bundle_assert_ready() from public, anon, authenticated;

-- Предпросмотр: только чтение (ничего не пишет, включая журнал запусков).
create or replace function eq_bundle_preview(p uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform eq_assert_admin();
  perform eq_bundle_assert_ready();
  return eq_bundle_run(p, 'manual', false, 'manual');
end $$;

-- Ручной пересчёт: только глобальный администратор, одна транзакция с блокировкой ребёнка, затем заказов по возрастанию id.
create or replace function eq_bundle_recalc(p uuid, mode text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform eq_assert_admin();
  if mode is distinct from 'manual' then raise exception 'bad mode' using errcode = '22023'; end if;
  perform eq_bundle_assert_ready();
  return eq_bundle_run(p, 'manual', true, 'manual');
end $$;

-- Ручной сброс отказа от скидки (Q3): причина обязательна, платежи не затрагиваются, итог меняется только пересчётом.
create or replace function eq_forfeit_reset(o uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  eo equipment_orders; uid uuid := current_user_id();
  who text := (select display_name from users where id = current_user_id());
begin
  perform eq_assert_admin();
  if nullif(trim(reason), '') is null then raise exception 'reason required' using errcode = '22023'; end if;
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not eo.discount_forfeited then raise exception 'not forfeited' using errcode = '22023'; end if;
  perform set_config('eq.op', 'forfeit', true);
  update equipment_orders set discount_forfeited = false where id = o;
  perform set_config('eq.op', '', true);
  insert into equipment_order_events (order_id, event, reason, data, created_by, created_by_name)
  values (o, 'forfeit_reset', trim(reason), jsonb_build_object('paid', eo.paid, 'total', eo.total), uid, who);
end $$;

-- Сводка по ребёнку (Q5): права вызывающего (читает через RLS заказов).
create or replace function eq_player_equipment_summary(p uuid)
returns table (paid_on_cancelled numeric, overpaid_active numeric, due_active numeric, orders_active int, orders_cancelled int)
language sql stable set search_path = public as $$
  select coalesce(sum(paid) filter (where status = 'cancelled'), 0),
         coalesce(sum(greatest(paid - total, 0)) filter (where status <> 'cancelled'), 0),
         coalesce(sum(greatest(total - paid, 0)) filter (where status <> 'cancelled'), 0),
         (count(*) filter (where status <> 'cancelled'))::int,
         (count(*) filter (where status = 'cancelled'))::int
    from equipment_orders where player_id = p
$$;

revoke execute on function eq_bundle_preview(uuid), eq_bundle_recalc(uuid, text), eq_forfeit_reset(uuid, text), eq_player_equipment_summary(uuid) from public, anon;
grant execute on function eq_bundle_preview(uuid), eq_bundle_recalc(uuid, text), eq_forfeit_reset(uuid, text), eq_player_equipment_summary(uuid) to authenticated;

-- 10. Снятие запрета «итог ниже оплаченного» (Q4). Тела 0102 (eq_edit_order) и 0125 (eq_edit_line, eq_delete_line).
-- eq_edit_line: сначала строка, потом итог (триггер итога видит актуальную сумму строк).
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

revoke execute on function eq_edit_order(uuid, text, text, boolean, text, numeric), eq_edit_line(uuid, text, int), eq_delete_line(uuid) from public, anon;
grant execute on function eq_edit_order(uuid, text, text, boolean, text, numeric), eq_edit_line(uuid, text, int), eq_delete_line(uuid) to authenticated;
