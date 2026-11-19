-- Откат миграции 0207 (#652 этап 2c). Запускать только по решению владельца, в SQL Editor целиком (один блок do, без begin/commit: SQL Editor режет такие блоки).
-- Что делает (в одной транзакции, при любой ошибке не меняет ничего):
--   снимает заморозку исторических комплектов (legacy_bundle_id), удаляет записи equipment_legacy_bundles, созданные 0207;
--   снимает отказ от скидки (discount_forfeited) у заказов, получивших его в 0207, и удаляет их события forfeit этапа 2c;
--   удаляет отметку freeze_2c; удаляет функции eq_freeze_2c и eq_freeze_2c_fp.
-- Не меняет: total, paid, статусы, строки, платёжный журнал, installment, manual_adjustment (её записала 0205; откат корректировок = откат 0205).
-- Откат отказывается работать, если после 2c уже были запуски расчёта или есть записи комплектов (итоги могли измениться), или если
-- в базе есть записи этапа 2c, созданные не миграцией 0207. После отката отпечатки заказов, строк и журнала совпадают с состоянием до 0207.
do $do$
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
  -- Только записи, однозначно созданные 0207 (reason этапа 2c и автор не задан). reason is null тоже считается чужой записью.
  if exists (select 1 from equipment_legacy_bundles where reason is null or reason not like '%(0207, этап 2c)%' or created_by is not null) then
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
  -- Отказ снимаем у всех заказов с событием 2c, включая отменённые (операция forfeit_2c в защите заказа, её вводила 0207).
  perform set_config('eq.op', 'forfeit_2c', true);
  update equipment_orders set discount_forfeited = false
   where discount_forfeited and id in (select order_id from equipment_order_events where event = 'forfeit' and data->>'step' = '2c');
  perform set_config('eq.op', '', true);

  -- Журналы только добавляются: на время отката снимаем защиту у трёх таблиц (в этой же транзакции возвращаем)
  alter table equipment_order_events disable trigger equipment_order_events_immutable;
  delete from equipment_order_events where event = 'forfeit' and data->>'step' = '2c' and created_by_name = 'миграция 0207 (этап 2c)';
  alter table equipment_order_events enable trigger equipment_order_events_immutable;
  alter table equipment_legacy_bundles disable trigger equipment_legacy_bundles_guard;
  delete from equipment_legacy_bundles where reason like '%(0207, этап 2c)%' and created_by is null;
  alter table equipment_legacy_bundles enable trigger equipment_legacy_bundles_guard;
  alter table equipment_bundle_steps disable trigger equipment_bundle_steps_guard;
  delete from equipment_bundle_steps where step = 'freeze_2c';
  alter table equipment_bundle_steps enable trigger equipment_bundle_steps_guard;

  if exists (select 1 from equipment_legacy_bundles) then raise exception 'rollback incomplete: legacy bundles remain' using errcode = '55000'; end if;
  select count(*) into n from equipment_orders where legacy_bundle_id is not null;
  if n > 0 then raise exception 'rollback incomplete: % orders still frozen', n using errcode = '55000'; end if;
  fp1 := eq_freeze_2c_fp();
  if fp1 is distinct from fp0 then raise exception 'invariant violated: orders, lines or journal changed' using errcode = '55000'; end if;

  -- Защита заказа возвращается к телу 0205 (без операции forfeit_2c)
  execute $g$
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
  $g$;

  drop function eq_freeze_2c(jsonb);
  drop function eq_freeze_2c_fp();
end $do$;
