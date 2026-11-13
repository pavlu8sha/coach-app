-- 0189 (#471 PR-2b): перенос исторических остатков оплат экипировки в журнал (opening_balance).
-- Условия: docs/acceptance/eq-471-pr2b-opening-balance-2026-11-13.md. Требует применённой 0188.
-- Миграция данных: запускает только владелец, после выгрузки db/ops/readonly-eq-baseline-471.sql. Один блок = одна транзакция:
-- любая ошибка (в том числе дельта < 0 или расхождение самопроверки) откатывает всё.
-- Дельта = paid - сумма журнала экипировки заказа. Дельта > 0 даёт одну строку opening_balance; дельта < 0 останавливает миграцию.
-- paid и total заказов не меняются: триггер 0188 строку opening_balance в paid не прибавляет (остаток уже внутри paid).
do $$
declare
  v_neg text;
  v_expected numeric;
  v_inserted numeric;
  v_paid_before numeric;
  v_total_before numeric;
  v_cash_before numeric;
  v_bad text;
  v_rows integer;
begin
  if to_regclass('public.service_payments') is null or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'service_payments' and column_name = 'op') then
    raise exception '0189 requires 0188';
  end if;

  -- Блокировка заказов на время переноса: оплаты в это время не должны менять paid.
  perform 1 from equipment_orders for update;

  drop table if exists _eq_ob_0189;
  create temp table _eq_ob_0189 on commit drop as
  select o.id as order_id, o.player_id, o.paid, o.total,
         coalesce((select sum(sp.amount) from service_payments sp where sp.kind = 'equipment' and sp.ref_id = o.id), 0) as journal,
         o.ordered_on, o.created_at,
         (select min(sp.paid_on) from service_payments sp where sp.kind = 'equipment' and sp.ref_id = o.id) as first_pay
    from equipment_orders o;

  -- О4: журнал больше paid — ничего не правим, останавливаемся со списком.
  select string_agg(order_id || ' paid=' || paid || ' journal=' || journal, '; ' order by order_id) into v_neg from _eq_ob_0189 where paid < journal;
  if v_neg is not null then
    raise exception 'journal exceeds paid, resolve manually: %', v_neg using errcode = '22023';
  end if;

  select coalesce(sum(paid), 0), coalesce(sum(total), 0) into v_paid_before, v_total_before from equipment_orders;
  select coalesce(sum(amount), 0) into v_cash_before from service_payments where op <> 'opening_balance';
  select coalesce(sum(paid - journal), 0) into v_expected from _eq_ob_0189 where paid > journal;

  -- О6: признак миграции только на время этой транзакции.
  perform set_config('eq.backfill_gate', 'on', true);
  with ins as (
    insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, recorded_by, note)
    select 'equipment', order_id, player_id, paid - journal,
           coalesce(ordered_on, first_pay, (created_at at time zone 'Asia/Tbilisi')::date), null, 'opening_balance', null,
           'Внесено до начала учёта в приложении'
      from _eq_ob_0189 where paid > journal
    returning amount)
  select coalesce(sum(amount), 0), count(*) into v_inserted, v_rows from ins;
  perform set_config('eq.backfill_gate', '', true);

  -- О5: самопроверка.
  if v_inserted <> v_expected then
    raise exception 'self-check: inserted % but expected %', v_inserted, v_expected;
  end if;
  select string_agg(o.id::text, ',') into v_bad from equipment_orders o
   where o.paid <> coalesce((select sum(sp.amount) from service_payments sp where sp.kind = 'equipment' and sp.ref_id = o.id), 0);
  if v_bad is not null then raise exception 'self-check: paid differs from journal for %', v_bad; end if;
  if (select coalesce(sum(paid), 0) from equipment_orders) <> v_paid_before or (select coalesce(sum(total), 0) from equipment_orders) <> v_total_before then
    raise exception 'self-check: order sums changed';
  end if;
  if (select coalesce(sum(amount), 0) from service_payments where op <> 'opening_balance') <> v_cash_before then
    raise exception 'self-check: cash sum changed';
  end if;
  if coalesce(current_setting('eq.backfill_gate', true), '') = 'on' then
    raise exception 'self-check: backfill gate left on';
  end if;
  drop table _eq_ob_0189;
  raise notice '0189: opening_balance rows added for % orders, total %', v_rows, v_expected;
end $$;
