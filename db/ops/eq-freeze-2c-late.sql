-- #652 этап 2b, подготовка: заморозка заказов «окна» между 2c (0207) и 2b (0208).
-- Зачем: после 0207 прежний клиент успел создать заказ со скидкой комплекта, записанной в итог (manual_adjustment < 0). 0207 повторно
-- не запускается (стоит отметка freeze_2c), а 0208 без заморозки добавила бы вторую скидку. Скрипт замораживает такие заказы так же, как 0207
-- (equipment_legacy_bundles kind = 'confirmed' + legacy_bundle_id у заказа и участников комплекта). Итоги, оплаты, строки, журнал, статусы не меняются.
-- Условия: docs/acceptance/eq-652-stage2c-late-freeze-2026-11-19.md. Применяет только Павел: SQL Editor, целиком, один блок do (без begin/commit).
-- Порядок: свежий preflight -> readonly-eq-2b-window.sql (список ожидаемых заказов) -> этот скрипт -> db/ops/verify-eq-freeze-2c-late.sql -> 0208.
-- Защиты (при любой ошибке не меняется ничего, одна транзакция):
--   * блокировки берутся до проверок (проверки видят конкурентный расчёт);
--   * заморозка 2c применена; расчётов после неё не было (нет запусков и комплектов): значит 0208 ещё не работала;
--   * набор заказов-кандидатов (не заморожены, не отменены, manual_adjustment < 0) в точности равен списку expect_ids ниже;
--   * каждый кандидат — замыкающий заказ полного комплекта, не в рассрочку, скидка расчёта равна его корректировке (иначе остановка, решает владелец);
--   * у ребёнка ещё нет записи комплекта; нет заказов в рассрочку без отказа;
--   * отпечатки заказов, строк и журнала до и после равны; итог = строки + корректировки у всех заказов.
-- Откат: db/ops/rollback-eq-freeze-2c-late.sql.
do $do$
declare
  expect_ids uuid[] := array['b8fbdf08-c24d-4df2-97de-da206c0a8dc3']::uuid[];  -- заказы, найденные в проде 19.11.2026 (readonly-eq-2b-window.sql)
  fp0 jsonb; fp1 jsonb; found_ids uuid[]; pl record; o record; inp jsonb; res jsonb; probe jsonb;
  st text; rsn text; closing uuid; disc numeric; parts uuid[]; lb uuid; bad int; n_frozen0 int; n_frozen1 int; n_new int := 0;
begin
  -- Сначала блокировки, потом все проверки: проверка «расчётов не было» должна видеть результат конкурентного расчёта, завершившегося до получения блокировки.
  -- Расчёт пишет в заказы (строка заказа, затем запись запуска), поэтому блокировка таблицы заказов дожидается его конца. Ожидание ограничено 15 с:
  -- при взаимной блокировке или долгой транзакции скрипт останавливается и ничего не меняет (повторить позже).
  perform set_config('lock_timeout', '15s', true);
  perform pg_advisory_xact_lock(hashtext('eq_freeze_2c'));
  lock table equipment_orders, equipment_order_lines, service_payments in share row exclusive mode;
  if not exists (select 1 from equipment_bundle_steps where step = 'freeze_2c') then
    raise exception 'freeze_2c is not applied' using errcode = '55000';
  end if;
  if exists (select 1 from equipment_bundle_runs) or exists (select 1 from equipment_bundles) then
    raise exception 'recalculation was already run after 2c: script stopped' using errcode = '55000';
  end if;

  select count(*) into bad from equipment_orders q where q.total <> eq_order_lines_sum(q.id) + q.manual_adjustment + q.bundle_adjustment or q.bundle_adjustment <> 0;
  if bad > 0 then raise exception 'unexpected state: % orders break total = lines + adjustments', bad using errcode = '55000'; end if;
  if exists (select 1 from equipment_orders where installment and not discount_forfeited) then
    raise exception 'unexpected state: installment orders without forfeit exist' using errcode = '55000';
  end if;

  select coalesce(array_agg(e.id order by e.id), '{}') into found_ids from equipment_orders e
   where e.legacy_bundle_id is null and e.status <> 'cancelled' and e.manual_adjustment < 0;
  if found_ids is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(expect_ids) x) then
    raise exception 'unexpected candidates: expected %, found %', expect_ids, found_ids using errcode = '55000';
  end if;
  if exists (select 1 from equipment_orders where legacy_bundle_id is null and status = 'cancelled' and manual_adjustment < 0) then
    raise exception 'unexpected state: cancelled unfrozen order with a discount exists' using errcode = '55000';
  end if;

  fp0 := eq_freeze_2c_fp();
  select count(*) into n_frozen0 from equipment_orders where legacy_bundle_id is not null;

  for pl in select distinct e.player_id as pid, p.club_id as cid from equipment_orders e join players p on p.id = e.player_id where e.id = any (found_ids) order by 1 loop
    if exists (select 1 from equipment_legacy_bundles b where b.player_id = pl.pid) then
      raise exception 'player % already has a legacy bundle: manual review needed', pl.pid using errcode = '55000';
    end if;
    inp := jsonb_build_object(
      'settings', jsonb_build_object('pct', eq_bundle_setting(pl.cid, 'equip.discPct'), 'round', eq_bundle_setting(pl.cid, 'equip.discRound'),
        'need_own', eq_bundle_setting(pl.cid, 'equip.discNeedOwn'), 'need_all', eq_bundle_setting(pl.cid, 'equip.discNeedAll'), 'full', eq_bundle_setting(pl.cid, 'equip.fullPrice')),
      'orders', (select jsonb_agg(jsonb_build_object('id', e.id, 'status', e.status, 'created_at', e.created_at, 'ordered_on', e.ordered_on,
                  'forfeited', false, 'frozen', false) order by e.id) from equipment_orders e where e.player_id = pl.pid),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'order_id', l.order_id, 'kit', l.kit, 'quantity', l.quantity, 'unit_price', l.unit_price) order by l.id)
                  from equipment_order_lines l join equipment_orders e on e.id = l.order_id where e.player_id = pl.pid), '[]'::jsonb));
    res := eq_bundle_calc(inp);
    st := res->>'state'; rsn := res->>'reason';
    closing := nullif(res->>'closing_order_id', '')::uuid;
    disc := coalesce((res->>'discount')::numeric, 0);
    select coalesce(array_agg(x::uuid), '{}') into parts from jsonb_array_elements_text(coalesce(res->'participants', '[]'::jsonb)) x;
    if st <> 'active' then
      raise exception 'player %: bundle discount is not active (state %, reason %): manual review needed', pl.pid, st, rsn using errcode = '55000';
    end if;
    for o in select e.id, e.installment, e.total - eq_order_lines_sum(e.id) as delta from equipment_orders e where e.player_id = pl.pid and e.id = any (found_ids) loop
      if o.id is distinct from closing or o.installment or abs(o.delta + disc) > 0.01 then
        raise exception 'order %: not a closing order of a full bundle with a matching discount (delta %, discount %): manual review needed', o.id, o.delta, disc using errcode = '55000';
      end if;
    end loop;
    insert into equipment_legacy_bundles (player_id, kind, reason, calc_discount)
    values (pl.pid, 'confirmed', 'исторический комплект: скидка уже в итоге заказа (позднее окно 2c, db/ops)', disc) returning id into lb;
    n_new := n_new + 1;
    perform set_config('eq.op', 'recalc', true);
    update equipment_orders e set legacy_bundle_id = lb
     where e.player_id = pl.pid and e.legacy_bundle_id is null and e.status <> 'cancelled' and (e.id = any (parts) or e.id = any (found_ids));
    perform set_config('eq.op', '', true);
  end loop;

  fp1 := eq_freeze_2c_fp();
  if fp1 is distinct from fp0 then
    raise exception 'invariant violated: orders, lines or journal changed (before %, after %)', fp0, fp1 using errcode = '55000';
  end if;
  select count(*) into bad from equipment_orders q where q.total <> eq_order_lines_sum(q.id) + q.manual_adjustment + q.bundle_adjustment or q.bundle_adjustment <> 0;
  if bad > 0 then raise exception 'invariant violated: % orders break total = lines + adjustments', bad using errcode = '55000'; end if;
  select count(*) into n_frozen1 from equipment_orders where legacy_bundle_id is not null;
  if n_frozen1 < n_frozen0 + array_length(found_ids, 1) then
    raise exception 'invariant violated: frozen orders % -> %', n_frozen0, n_frozen1 using errcode = '55000';
  end if;
  if exists (select 1 from equipment_orders where legacy_bundle_id is null and status <> 'cancelled' and manual_adjustment < 0) then
    raise exception 'invariant violated: unfrozen discount orders remain' using errcode = '55000';
  end if;
end $do$;
