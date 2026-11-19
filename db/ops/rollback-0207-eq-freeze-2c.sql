-- Откат миграции 0207 (#652 этап 2c). Запускать только по решению владельца, в SQL Editor целиком (один блок do, без begin/commit: SQL Editor режет такие блоки).
-- Что делает (в одной транзакции, при любой ошибке не меняет ничего):
--   снимает заморозку исторических комплектов (legacy_bundle_id), удаляет записи equipment_legacy_bundles, созданные 0207;
--   снимает отказ от скидки (discount_forfeited) у заказов, получивших его в 0207, и удаляет их события forfeit этапа 2c;
--   удаляет отметку freeze_2c; удаляет функции eq_freeze_2c и eq_freeze_2c_fp.
-- Не меняет: total, paid, статусы, строки, платёжный журнал, installment, manual_adjustment (её записала 0205; откат корректировок = откат 0205).
-- Откат отказывается работать, если после 2c уже были запуски расчёта или есть записи комплектов (итоги могли измениться), или если
-- в базе есть записи этапа 2c, созданные не миграцией 0207. После отката отпечатки заказов, строк и журнала совпадают с состоянием до 0207.
do $$
declare
  fp0 jsonb; fp1 jsonb; n int;
begin
  if not exists (select 1 from equipment_bundle_steps where step = 'freeze_2c') then
    raise exception 'freeze_2c is not applied: nothing to roll back' using errcode = '55000';
  end if;
  if exists (select 1 from equipment_bundle_steps where step <> 'freeze_2c') then
    raise exception 'unexpected steps, rollback stopped' using errcode = '55000';
  end if;
  if exists (select 1 from equipment_bundle_runs) or exists (select 1 from equipment_bundles) then
    raise exception 'recalculation was run after 2c (runs or bundles exist): rollback stopped' using errcode = '55000';
  end if;
  if exists (select 1 from equipment_legacy_bundles where reason not like '%0207%') then
    raise exception 'legacy bundles not created by 0207 exist: rollback stopped' using errcode = '55000';
  end if;
  if exists (select 1 from equipment_order_events where event = 'recalc') then
    raise exception 'recalc events exist: rollback stopped' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtext('eq_freeze_2c'));
  lock table equipment_orders, equipment_order_lines, service_payments in share row exclusive mode;
  fp0 := eq_freeze_2c_fp();

  -- Заморозка: через разрешённый путь защиты заказа (eq.op = recalc)
  perform set_config('eq.op', 'recalc', true);
  update equipment_orders set legacy_bundle_id = null where legacy_bundle_id is not null;
  -- Отказ: только у заказов с событием forfeit этапа 2c
  perform set_config('eq.op', 'forfeit', true);
  update equipment_orders set discount_forfeited = false
   where discount_forfeited and id in (select order_id from equipment_order_events where event = 'forfeit' and data->>'step' = '2c');
  perform set_config('eq.op', '', true);

  -- Журналы только добавляются: на время отката снимаем защиту у трёх таблиц (в этой же транзакции возвращаем)
  alter table equipment_order_events disable trigger equipment_order_events_immutable;
  delete from equipment_order_events where event = 'forfeit' and data->>'step' = '2c' and created_by_name = 'миграция 0207 (этап 2c)';
  alter table equipment_order_events enable trigger equipment_order_events_immutable;
  alter table equipment_legacy_bundles disable trigger equipment_legacy_bundles_guard;
  delete from equipment_legacy_bundles;
  alter table equipment_legacy_bundles enable trigger equipment_legacy_bundles_guard;
  alter table equipment_bundle_steps disable trigger equipment_bundle_steps_guard;
  delete from equipment_bundle_steps where step = 'freeze_2c';
  alter table equipment_bundle_steps enable trigger equipment_bundle_steps_guard;

  select count(*) into n from equipment_orders where legacy_bundle_id is not null;
  if n > 0 then raise exception 'rollback incomplete: % orders still frozen', n using errcode = '55000'; end if;
  fp1 := eq_freeze_2c_fp();
  if fp1 is distinct from fp0 then raise exception 'invariant violated: orders, lines or journal changed' using errcode = '55000'; end if;

  drop function eq_freeze_2c(jsonb);
  drop function eq_freeze_2c_fp();
end $$;
