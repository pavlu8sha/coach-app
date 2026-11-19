-- Откат db/ops/eq-freeze-2c-late.sql: снимает заморозку у заказов, замороженных этим скриптом, и удаляет его записи комплектов.
-- Остальное (заморозка 0207, итоги, оплаты, журнал) не трогает. Отказывается работать, если после скрипта уже были расчёты (запуски или комплекты).
-- Принадлежность записей определяется не текстом reason, а точными наборами ниже: записи комплектов должны быть ровно у ожидаемых детей
-- (по одной, kind confirmed, не освобождены, автор не задан, текст позднего окна), а замороженные ими заказы должны быть ровно ожидаемыми.
-- При любом расхождении остановка без изменений. Блокировки берутся до проверок.
-- SQL Editor целиком, один блок do (без begin/commit).
do $do$
declare
  expect_players uuid[] := array['be1e9ce5-4472-4248-a686-04027d0c200c']::uuid[];   -- ребёнок, замороженный скриптом 19.11.2026
  expect_orders uuid[] := array['b8fbdf08-c24d-4df2-97de-da206c0a8dc3']::uuid[];    -- заказы, замороженные скриптом (кандидат и участники комплекта)
  fp0 jsonb; fp1 jsonb; bundle_ids uuid[]; got_players uuid[]; got_orders uuid[]; n int;
begin
  perform set_config('lock_timeout', '15s', true);
  perform pg_advisory_xact_lock(hashtext('eq_freeze_2c'));
  lock table equipment_orders, equipment_order_lines, service_payments in share row exclusive mode;
  if exists (select 1 from equipment_bundle_runs) or exists (select 1 from equipment_bundles) then
    raise exception 'recalculation was run after the late freeze: rollback stopped' using errcode = '55000';
  end if;
  select coalesce(array_agg(b.id order by b.id), '{}'), coalesce(array_agg(b.player_id order by b.player_id), '{}') into bundle_ids, got_players
    from equipment_legacy_bundles b
   where b.reason like '%(позднее окно 2c, db/ops)%' and b.created_by is null and b.kind = 'confirmed' and b.released_at is null;
  if got_players is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(expect_players) x) then
    raise exception 'unexpected late bundles: expected players %, found %', expect_players, got_players using errcode = '55000';
  end if;
  select coalesce(array_agg(e.id order by e.id), '{}') into got_orders from equipment_orders e where e.legacy_bundle_id = any (bundle_ids);
  if got_orders is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(expect_orders) x) then
    raise exception 'unexpected frozen orders: expected %, found %', expect_orders, got_orders using errcode = '55000';
  end if;
  fp0 := eq_freeze_2c_fp();
  perform set_config('eq.op', 'recalc', true);
  update equipment_orders set legacy_bundle_id = null where id = any (expect_orders) and legacy_bundle_id = any (bundle_ids);
  perform set_config('eq.op', '', true);
  alter table equipment_legacy_bundles disable trigger equipment_legacy_bundles_guard;
  delete from equipment_legacy_bundles where id = any (bundle_ids);
  alter table equipment_legacy_bundles enable trigger equipment_legacy_bundles_guard;
  select count(*) into n from equipment_legacy_bundles where id = any (bundle_ids);
  if n > 0 then raise exception 'rollback incomplete: late bundles remain' using errcode = '55000'; end if;
  select count(*) into n from equipment_orders where id = any (expect_orders) and legacy_bundle_id is not null;
  if n > 0 then raise exception 'rollback incomplete: % orders still frozen', n using errcode = '55000'; end if;
  fp1 := eq_freeze_2c_fp();
  if fp1 is distinct from fp0 then raise exception 'invariant violated: orders, lines or journal changed' using errcode = '55000'; end if;
end $do$;
