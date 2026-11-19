-- 0207: #652, этап 2c. Заморозка исторических комплектов экипировки и отказ от скидки у заказов в рассрочку (данные, шаг 2c).
-- Условия: docs/acceptance/eq-652-stage2c-freeze-0207-2026-11-19.md (С1–С12) и часть 2c в docs/acceptance/eq-652-stage2-bundle-discount-2026-11-16.md (В1–В7, И1–И7).
-- Порядок применения строго: 0205 -> 0207 -> 0208. Миграцию применяет только Павел после preflight и свежего readonly-eq-baseline-471.sql.
-- Что делает: всё внутри одного вызова eq_freeze_2c (одна транзакция, любая ошибка откатывает всё):
--   1) снимает отпечатки до, классифицирует заказы (exact / manual_up / manual_down / legacy_confirmed / legacy_review) по правилам расчёта 2a;
--   2) пишет equipment_legacy_bundles и ставит legacy_bundle_id заказам комплекта (заморожены целиком);
--   3) ставит discount_forfeited заказам с installment = true (F4) и событие forfeit;
--   4) сверяет отпечатки после (заказы, строки, журнал экипировки, суммы), И4, счётчики; ставит отметку freeze_2c.
-- total, paid, manual_adjustment (её записала 0205), строки, журнал и статусы не меняются. Повторный запуск ничего не меняет.
-- Ожидания прода (baseline 16.11.2026) заданы параметром в конце файла: при расхождении вызов останавливается и ничего не применяет.
-- Откат: db/ops/rollback-0207-eq-freeze-2c.sql.

-- Отпечатки (те же поля, что в db/ops/readonly-eq-baseline-471.sql, чтобы цифры можно было сравнить глазами).
create or replace function eq_freeze_2c_fp() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'orders', (select md5(coalesce(string_agg(concat_ws('|', id, total, paid, status, installment, location, ordered_on), ',' order by id), '')) from equipment_orders),
    'lines', (select md5(coalesce(string_agg(concat_ws('|', id, order_id, kit, size, quantity, unit_price), ',' order by id), '')) from equipment_order_lines),
    'journal', (select md5(coalesce(string_agg(concat_ws('|', id, ref_id, amount, paid_on, method, cancels), ',' order by id), '')) from service_payments where kind = 'equipment'),
    'orders_count', (select count(*) from equipment_orders),
    'total', (select coalesce(sum(total), 0) from equipment_orders),
    'paid', (select coalesce(sum(paid), 0) from equipment_orders))
$$;
revoke execute on function eq_freeze_2c_fp() from public, anon, authenticated, service_role;

create or replace function eq_freeze_2c(exp jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fp0 jsonb; fp1 jsonb;
  pl record; o record; inp jsonb; res jsonb;
  st text; rsn text; closing uuid; disc numeric; parts uuid[]; full_set boolean; cls text;
  cnt jsonb; k text; want numeric; got numeric;
  lb uuid; n_conf int := 0; n_rev int := 0; n_forf int := 0; n_frozen int := 0; bad int;
  note jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('eq_freeze_2c'));
  if exists (select 1 from equipment_bundle_steps where step = 'freeze_2c') then
    return jsonb_build_object('skipped', 'already applied');
  end if;
  lock table equipment_orders, equipment_order_lines, service_payments in share row exclusive mode;

  -- Исходное состояние: расчёт и заморозка ещё не запускались, итог = строки + корректировка (И4).
  if exists (select 1 from equipment_orders where bundle_adjustment <> 0 or legacy_bundle_id is not null) then
    raise exception 'unexpected state: discount fields already set' using errcode = '55000';
  end if;
  select count(*) into bad from equipment_orders q where q.total <> eq_order_lines_sum(q.id) + q.manual_adjustment + q.bundle_adjustment;
  if bad > 0 then raise exception 'unexpected state: % orders break total = lines + adjustments', bad using errcode = '55000'; end if;

  fp0 := eq_freeze_2c_fp();

  -- 1. Классификация
  create temp table if not exists eq2c_cls (
    order_id uuid primary key, player_id uuid, cls text not null, delta numeric not null, part boolean not null default false, disc numeric
  ) on commit drop;
  truncate eq2c_cls;

  for pl in select distinct x.player_id as pid, p.club_id as cid from equipment_orders x join players p on p.id = x.player_id order by 1 loop
    inp := jsonb_build_object(
      'settings', jsonb_build_object('pct', eq_bundle_setting(pl.cid, 'equip.discPct'), 'round', eq_bundle_setting(pl.cid, 'equip.discRound'),
        'need_own', eq_bundle_setting(pl.cid, 'equip.discNeedOwn'), 'need_all', eq_bundle_setting(pl.cid, 'equip.discNeedAll'), 'full', eq_bundle_setting(pl.cid, 'equip.fullPrice')),
      -- отказ и заморозка в классификацию не входят: решение принимается по данным, как они были до 2c
      'orders', (select jsonb_agg(jsonb_build_object('id', e.id, 'status', e.status, 'created_at', e.created_at, 'ordered_on', e.ordered_on,
                  'forfeited', false, 'frozen', false) order by e.id) from equipment_orders e where e.player_id = pl.pid),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'order_id', l.order_id, 'kit', l.kit, 'quantity', l.quantity, 'unit_price', l.unit_price) order by l.id)
                  from equipment_order_lines l join equipment_orders e on e.id = l.order_id where e.player_id = pl.pid), '[]'::jsonb));
    res := eq_bundle_calc(inp);
    st := res->>'state'; rsn := res->>'reason';
    closing := nullif(res->>'closing_order_id', '')::uuid;
    disc := coalesce((res->>'discount')::numeric, 0);
    select coalesce(array_agg(x::uuid), '{}') into parts from jsonb_array_elements_text(coalesce(res->'participants', '[]'::jsonb)) x;
    -- полный комплект: расчёт дошёл до замыкающего заказа (скидка есть или не прошла по discNeedAll / нулевая)
    full_set := st = 'active' or rsn in ('need_all_failed', 'no_discount');

    for o in select e.id, e.status, e.installment, e.total - eq_order_lines_sum(e.id) as delta from equipment_orders e where e.player_id = pl.pid order by e.id loop
      cls := case
        when o.delta = 0 then 'exact'
        when o.delta > 0 then 'manual_up'
        when o.status = 'cancelled' then 'manual_down'
        when st = 'unchecked' then 'legacy_review'
        when not full_set then 'manual_down'
        when o.id = closing and not o.installment and st = 'active' and abs(o.delta + disc) <= 0.01 then 'legacy_confirmed'
        else 'legacy_review' end;
      insert into eq2c_cls (order_id, player_id, cls, delta, part, disc) values (o.id, pl.pid, cls, o.delta, o.id = any (parts), disc);
    end loop;
  end loop;
  -- заказы без игрока: комплекта нет, только по знаку разницы
  insert into eq2c_cls (order_id, player_id, cls, delta, part, disc)
  select e.id, null, case when d = 0 then 'exact' when d > 0 then 'manual_up' else 'manual_down' end, d, false, 0
    from (select e2.id, e2.total - eq_order_lines_sum(e2.id) as d from equipment_orders e2 where e2.player_id is null) e;

  cnt := coalesce((select jsonb_object_agg(q.cls, q.c) from (select c.cls, count(*) as c from eq2c_cls c group by c.cls) q), '{}'::jsonb);

  -- 2. Ожидания (если заданы): при расхождении ничего не применяется
  foreach k in array array['orders', 'total', 'paid', 'exact', 'manual_up', 'manual_down', 'legacy_confirmed', 'legacy_review', 'installment'] loop
    if exp ? k then
      got := case k
        when 'orders' then (select count(*) from equipment_orders)
        when 'total' then (select coalesce(sum(total), 0) from equipment_orders)
        when 'paid' then (select coalesce(sum(paid), 0) from equipment_orders)
        when 'installment' then (select count(*) from equipment_orders where installment and status <> 'cancelled' and not discount_forfeited)
        else coalesce((cnt->>k)::numeric, 0) end;
      want := (exp->>k)::numeric;
      if got is distinct from want then
        raise exception 'unexpected baseline: % expected %, found %', k, want, got using errcode = '55000';
      end if;
    end if;
  end loop;

  -- 3. Заморозка исторических комплектов (по одному ребёнку не более одной записи каждого вида)
  perform set_config('eq.op', 'recalc', true);
  for pl in select c.player_id as pid, bool_or(c.cls = 'legacy_confirmed') as conf, bool_or(c.cls = 'legacy_review') as rev, max(c.disc) as disc
              from eq2c_cls c where c.player_id is not null and c.cls in ('legacy_confirmed', 'legacy_review') group by c.player_id order by c.player_id loop
    if pl.conf then
      insert into equipment_legacy_bundles (player_id, kind, reason, calc_discount)
      values (pl.pid, 'confirmed', 'исторический комплект: скидка уже в итоге заказа (0207, этап 2c)', pl.disc) returning id into lb;
      n_conf := n_conf + 1;
      update equipment_orders e set legacy_bundle_id = lb
        from eq2c_cls c where c.order_id = e.id and c.player_id = pl.pid and (c.part or c.cls = 'legacy_confirmed') and e.status <> 'cancelled';
    end if;
    if pl.rev then
      insert into equipment_legacy_bundles (player_id, kind, reason, calc_discount)
      values (pl.pid, 'review', 'исторический заказ на разбор владельцем (0207, этап 2c)', pl.disc) returning id into lb;
      n_rev := n_rev + 1;
      update equipment_orders e set legacy_bundle_id = lb
        from eq2c_cls c where c.order_id = e.id and c.player_id = pl.pid
         and (c.cls = 'legacy_review' or (not pl.conf and c.part and e.legacy_bundle_id is null)) and e.status <> 'cancelled';
    end if;
  end loop;

  -- 4. Отказ от скидки у заказов в рассрочку (F4); installment не меняется
  select count(*) into n_forf from equipment_orders where installment and status <> 'cancelled' and not discount_forfeited;
  perform set_config('eq.op', 'forfeit', true);
  with f as (update equipment_orders set discount_forfeited = true where installment and status <> 'cancelled' and not discount_forfeited returning id, total, paid)
  insert into equipment_order_events (order_id, event, reason, data, created_by_name)
  select f.id, 'forfeit', 'исторический заказ в рассрочку: отказ от скидки (F4, 0207, этап 2c)', jsonb_build_object('step', '2c', 'total', f.total, 'paid', f.paid), 'миграция 0207 (этап 2c)' from f;
  perform set_config('eq.op', '', true);

  -- 5. Сверка после: ничего, кроме новых полей, не изменилось
  fp1 := eq_freeze_2c_fp();
  if fp1 is distinct from fp0 then
    raise exception 'invariant violated: orders, lines or journal changed (before %, after %)', fp0, fp1 using errcode = '55000';
  end if;
  select count(*) into bad from equipment_orders q where q.total <> eq_order_lines_sum(q.id) + q.manual_adjustment + q.bundle_adjustment or q.bundle_adjustment <> 0;
  if bad > 0 then raise exception 'invariant violated: % orders break total = lines + adjustments', bad using errcode = '55000'; end if;
  select count(*) into n_frozen from equipment_orders where legacy_bundle_id is not null;
  if n_frozen < n_conf then raise exception 'invariant violated: frozen orders % < bundles %', n_frozen, n_conf using errcode = '55000'; end if;
  if (select count(*) from equipment_orders where legacy_bundle_id is not null and not exists (select 1 from equipment_legacy_bundles b where b.id = legacy_bundle_id)) > 0 then
    raise exception 'invariant violated: dangling legacy_bundle_id' using errcode = '55000';
  end if;

  note := jsonb_build_object('classes', cnt, 'bundles_confirmed', n_conf, 'bundles_review', n_rev, 'frozen_orders', n_frozen, 'forfeited', n_forf, 'before', fp0, 'after', fp1);
  insert into equipment_bundle_steps (step, note) values ('freeze_2c', note::text);
  return note;
end $$;
revoke execute on function eq_freeze_2c(jsonb) from public, anon, authenticated, service_role;

-- Применение. Ожидания прода (baseline 16.11.2026, прислан Павлом): 149 заказов, итог 38015, оплачено 32135,
-- exact 135, legacy_confirmed 14, manual_up 0, manual_down 0, legacy_review 0, заказов в рассрочку 9.
-- Если заказов в базе нет (чистая тестовая база), ожидания не применяются.
do $$
begin
  perform eq_freeze_2c(case when exists (select 1 from equipment_orders) then jsonb_build_object(
    'orders', 149, 'total', 38015, 'paid', 32135, 'exact', 135, 'manual_up', 0, 'manual_down', 0,
    'legacy_confirmed', 14, 'legacy_review', 0, 'installment', 9) else '{}'::jsonb end);
end $$;
