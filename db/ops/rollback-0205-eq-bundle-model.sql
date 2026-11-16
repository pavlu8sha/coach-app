-- Откат миграции 0205 (#652 этап 2a). Запускать только по решению владельца, в SQL Editor целиком, в одной транзакции.
-- ВНИМАНИЕ: до отката должны быть откачены 0206/0207, если они применялись. Итоги заказов (total) не меняются;
-- поля manual_adjustment, bundle_adjustment, discount_forfeited, legacy_bundle_id и записи комплектов удаляются вместе с таблицами.
-- Платёжный журнал и paid не затрагиваются. События заказа с видами recalc/forfeit/forfeit_reset сохраняются (журнал только добавляется),
-- поэтому, если они есть, расширенная проверка вида события остаётся.
begin;
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'equipment_bundle_steps')
     and exists (select 1 from equipment_bundle_steps where step <> 'freeze_2c') then
    raise exception 'unexpected steps, rollback stopped';
  end if;
end $$;

-- Защита заказа: тело 0188
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
  if old.status = 'cancelled' and new.status = 'cancelled' then
    if new.paid > old.paid or (to_jsonb(new) - 'paid') is distinct from (to_jsonb(old) - 'paid') then
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

drop trigger if exists equipment_orders_zresidual on equipment_orders;
drop function if exists eq_orders_zresidual();

-- Функции правки: тела 0102 и 0125 (с проверкой «итог не ниже оплаченного»)
create or replace function eq_edit_order(o uuid, insc text, num text, inst boolean, loc text, new_total numeric) returns void
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders;
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if new_total is null or new_total < eo.paid then raise exception 'total below paid' using errcode = '22023'; end if;
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
  if qty is null or qty < 1 or qty > 10 then raise exception 'bad quantity' using errcode = '22023'; end if;
  if qty <> ln.quantity then
    if exists (select 1 from equipment_issues where order_id = ln.order_id and kit = ln.kit) then raise exception 'item issued' using errcode = '22023'; end if;
    delta := ln.unit_price * (qty - ln.quantity);
    if eo.total + delta < eo.paid then raise exception 'total below paid' using errcode = '22023'; end if;
    update equipment_orders set total = total + delta where id = eo.id;
  end if;
  update equipment_order_lines set size = nullif(trim(sz), ''), quantity = qty where id = l;
end $$;

create or replace function eq_delete_line(l uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ln equipment_order_lines; eo equipment_orders; amt numeric;
begin
  perform eq_assert_admin();
  select * into ln from equipment_order_lines where id = l;
  if not found then raise exception 'line not found' using errcode = 'P0002'; end if;
  select * into eo from equipment_orders where id = ln.order_id for update;
  if exists (select 1 from equipment_issues where order_id = ln.order_id and kit = ln.kit) then raise exception 'item issued' using errcode = '22023'; end if;
  if (select count(*) from equipment_order_lines where order_id = ln.order_id) <= 1 then raise exception 'last line' using errcode = '22023'; end if;
  amt := ln.unit_price * ln.quantity;
  if eo.total - amt < eo.paid then raise exception 'total below paid' using errcode = '22023'; end if;
  delete from equipment_order_lines where id = l;
  update equipment_orders set total = total - amt where id = eo.id;
end $$;

revoke execute on function eq_edit_order(uuid, text, text, boolean, text, numeric), eq_edit_line(uuid, text, int), eq_delete_line(uuid) from public, anon;
grant execute on function eq_edit_order(uuid, text, text, boolean, text, numeric), eq_edit_line(uuid, text, int), eq_delete_line(uuid) to authenticated;

drop function if exists eq_bundle_preview(uuid);
drop function if exists eq_bundle_recalc(uuid, text);
drop function if exists eq_forfeit_reset(uuid, text);
drop function if exists eq_player_equipment_summary(uuid);
drop function if exists eq_bundle_run(uuid, text, boolean, text);
drop function if exists eq_bundle_assert_ready();
drop function if exists eq_bundle_calc(jsonb);
drop function if exists eq_bundle_rule_ok(jsonb, text[]);
drop function if exists eq_bundle_rule(text);
drop function if exists eq_bundle_setting(uuid, text);

alter table equipment_orders drop constraint if exists equipment_orders_legacy_bundle_fk;
drop table if exists equipment_bundle_status;
drop table if exists equipment_bundles;
drop table if exists equipment_bundle_runs;
drop table if exists equipment_bundle_steps;
drop table if exists equipment_legacy_bundles;
drop function if exists eq_bundles_guard();
drop function if exists eq_runs_append_only();
alter table equipment_orders drop constraint if exists equipment_orders_bundle_adjustment_check, drop constraint if exists equipment_orders_discount_state_check;
alter table equipment_orders drop column if exists discount_forfeited, drop column if exists manual_adjustment, drop column if exists bundle_adjustment,
  drop column if exists discount_state, drop column if exists legacy_bundle_id;
drop function if exists eq_order_lines_sum(uuid);

do $$ begin
  if not exists (select 1 from equipment_order_events where event not in ('cancel', 'restore')) then
    alter table equipment_order_events drop constraint if exists equipment_order_events_event_check;
    alter table equipment_order_events add constraint equipment_order_events_event_check check (event in ('cancel', 'restore'));
  end if;
end $$;
commit;
