-- Откат db/ops/eq-freeze-2c-late.sql: снимает заморозку у заказов, замороженных этим скриптом, и удаляет его записи комплектов.
-- Остальное (заморозка 0207, итоги, оплаты, журнал) не трогает. Отказывается работать, если после скрипта уже были расчёты (запуски или комплекты).
-- SQL Editor целиком, один блок do (без begin/commit).
do $do$
declare fp0 jsonb; fp1 jsonb; n int;
begin
  if exists (select 1 from equipment_bundle_runs) or exists (select 1 from equipment_bundles) then
    raise exception 'recalculation was run after the late freeze: rollback stopped' using errcode = '55000';
  end if;
  if not exists (select 1 from equipment_legacy_bundles where reason like '%(позднее окно 2c, db/ops)%' and created_by is null) then
    raise exception 'late freeze was not applied: nothing to roll back' using errcode = '55000';
  end if;
  perform pg_advisory_xact_lock(hashtext('eq_freeze_2c'));
  lock table equipment_orders, equipment_order_lines, service_payments in share row exclusive mode;
  fp0 := eq_freeze_2c_fp();
  perform set_config('eq.op', 'recalc', true);
  update equipment_orders set legacy_bundle_id = null
   where legacy_bundle_id in (select id from equipment_legacy_bundles where reason like '%(позднее окно 2c, db/ops)%' and created_by is null);
  perform set_config('eq.op', '', true);
  alter table equipment_legacy_bundles disable trigger equipment_legacy_bundles_guard;
  delete from equipment_legacy_bundles where reason like '%(позднее окно 2c, db/ops)%' and created_by is null;
  alter table equipment_legacy_bundles enable trigger equipment_legacy_bundles_guard;
  select count(*) into n from equipment_legacy_bundles where reason like '%(позднее окно 2c, db/ops)%';
  if n > 0 then raise exception 'rollback incomplete: late bundles remain' using errcode = '55000'; end if;
  fp1 := eq_freeze_2c_fp();
  if fp1 is distinct from fp0 then raise exception 'invariant violated: orders, lines or journal changed' using errcode = '55000'; end if;
end $do$;
