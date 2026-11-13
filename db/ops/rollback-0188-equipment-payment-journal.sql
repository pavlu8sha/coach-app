-- Откат миграции 0188 (#471 PR-2a). Запускать только по решению владельца, в SQL Editor целиком, в одной транзакции.
-- Возвращает eq_add_payment (тело 0157), защиту заказа (тело 0185), кассовые отчёты и права на таблицы к состоянию до 0188;
-- удаляет сторно, возврат, триггеры журнала, ограничения и поля op, request_id, note.
-- Откат отказывается работать, если в журнале есть строки opening_balance (после удаления op они стали бы кассовыми деньгами):
-- сначала их разбирает владелец (миграция 0189 и её откат). Строки reversal и refund остаются обычными строками с минусом.
begin;
do $$
begin
  if exists (select 1 from service_payments where op = 'opening_balance') then
    raise exception 'rollback 0188: в журнале есть opening_balance, сначала откатить 0189';
  end if;
end $$;

drop trigger if exists service_payments_paid_sync on service_payments;
drop trigger if exists service_payments_insert_guard on service_payments;
drop function if exists eq_paid_sync();
drop function if exists service_payments_insert_guard();
drop function if exists eq_reverse_payment(uuid, text, uuid);
drop function if exists eq_refund(uuid, numeric, date, text, text, uuid);
drop function if exists eq_add_payment(uuid, numeric, date, text, uuid);

create or replace function eq_orders_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  op text := coalesce(current_setting('eq.op', true), '');
begin
  if tg_op = 'INSERT' then
    -- автор всегда вошедший пользователь (клиентское значение не принимается); у владельца в SQL Editor пусто
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
    -- у отменённого заказа может только уменьшиться paid (ручное исправление владельца, возвраты PR-2)
    if new.paid > old.paid or (to_jsonb(new) - 'paid') is distinct from (to_jsonb(old) - 'paid') then
      raise exception 'order cancelled' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;;
CREATE OR REPLACE FUNCTION public.eq_add_payment(o uuid, amt numeric, d date DEFAULT NULL::date, mth text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare eo equipment_orders; np numeric;
begin
  if not (is_admin() or has_location_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not is_admin() and not is_location_admin(eo.location) then raise exception 'forbidden' using errcode = '42501'; end if;
  if amt is null or amt = 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if d is not null and d > tbilisi_day(now()) then raise exception 'bad date' using errcode = '22023'; end if;
  perform service_method_ok(mth);
  np := eo.paid + amt;
  if np < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  if np > eo.total then raise exception 'paid above total' using errcode = '22023'; end if;
  update equipment_orders set paid = np where id = o;
  perform service_payment_add('equipment', o, eo.player_id, amt, d, mth);
  return np;
end $function$;
revoke execute on function eq_add_payment(uuid, numeric, date, text) from public, anon;
grant execute on function eq_add_payment(uuid, numeric, date, text) to authenticated;

CREATE OR REPLACE FUNCTION public.cash_report(p_from date, p_to date, p_location text DEFAULT NULL::text, p_staff uuid DEFAULT NULL::uuid, p_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare res jsonb;
begin
  if not is_admin() and not has_location_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad period' using errcode = '22023'; end if;

  with src as (
    select 'Абонемент' as kind, p.id, p.player_id, p.amount, p.paid_on, p.method, p.recorded_by, p.recorded_at, gr.location as location
      from payments p join players pl on pl.id = p.player_id left join groups gr on gr.id = pl.group_id
    union all
    select 'Сбор', c.id, c.player_id, c.amount, c.paid_on, c.method, c.recorded_by, c.recorded_at, cm.location
      from camp_payments c left join camps cm on cm.id = c.camp_id
    union all
    select 'Взнос матча', m.id, m.player_id, m.amount, m.paid_on, m.method, m.recorded_by, m.recorded_at, null
      from match_payments m
    union all
    select 'Взнос события', t.id, t.player_id, t.amount, t.paid_on, t.method, t.recorded_by, t.recorded_at, null
      from tournament_payments t
    union all
    select case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' when 'visit' then 'Разовое посещение' else 'Доп. занятие' end,
           sp.id, sp.player_id, sp.amount, sp.paid_on, sp.method, sp.recorded_by, sp.recorded_at,
           case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                        when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id)
                        when 'visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id) end
      from service_payments sp
  ), rows_f as (
    select s.*, case when s.method in ('Наличные', 'Перевод') then s.method else 'не указан' end as method_key
      from src s
     where s.paid_on between p_from and p_to
       and (p_location is null or s.location = p_location)
       and (p_staff is null or s.recorded_by = p_staff)
       and (is_admin() or (s.recorded_by = current_user_id()
                           and s.location in (select la.location from location_admins la where la.user_id = current_user_id())))
  ), rows_m as (
    select * from rows_f where p_method is null or method_key = p_method
  )
  select jsonb_build_object(
    'total', coalesce((select sum(amount) from rows_m), 0),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method_key, 'sum', sm) order by method_key)
                             from (select method_key, sum(amount) sm from rows_m group by method_key) x), '[]'::jsonb),
    'by_staff', coalesce((select jsonb_agg(jsonb_build_object('staff_id', staff_id, 'name', staff_name, 'sum', sm) order by staff_name)
                            from (select r.recorded_by as staff_id, coalesce(u.display_name, 'не указан') as staff_name, sum(r.amount) sm
                                    from rows_m r left join users u on u.id = r.recorded_by
                                   group by r.recorded_by, u.display_name) x), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', r.id, 'kind', r.kind, 'player', pl.full_name, 'amount', r.amount, 'paid_on', r.paid_on,
                        'method', r.method_key, 'staff', coalesce(u.display_name, 'не указан'), 'recorded_at', r.recorded_at,
                        'location', r.location)
                       order by r.paid_on, r.recorded_at nulls last, r.id)
                     from rows_m r join players pl on pl.id = r.player_id left join users u on u.id = r.recorded_by), '[]'::jsonb)
  ) into res;
  return res;
end $function$;

CREATE OR REPLACE FUNCTION public.cash_day_service(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() and not has_location_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'method', x.method, 'what', x.what,
                                        'player_id', x.player_id, 'full_name', x.full_name, 'recorded_at', x.recorded_at,
                                        'detail', x.detail)
                     order by x.recorded_at nulls last, x.id)
      from (
        select sp.id, sp.amount, sp.method, sp.player_id, pl.full_name, sp.recorded_at,
               case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' when 'visit' then 'Разовое посещение' else 'Доп. занятие' end as what,
               case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                            when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id)
                            when 'visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id) end as loc,
               null::text as detail
          from service_payments sp join players pl on pl.id = sp.player_id
         where sp.paid_on = p_day
        union all
        select mp.id, mp.amount, mp.method, mp.player_id, pl.full_name, mp.recorded_at,
               'Взнос матча', null::text,
               concat_ws(' ', to_char(m.played_on, 'DD.MM'), nullif(m.opponent, ''))
          from match_payments mp join players pl on pl.id = mp.player_id join matches m on m.id = mp.match_id
         where mp.paid_on = p_day
        union all
        select tp.id, tp.amount, tp.method, tp.player_id, pl.full_name, tp.recorded_at,
               'Взнос события', null::text, t.name
          from tournament_payments tp join players pl on pl.id = tp.player_id join tournaments t on t.id = tp.tournament_id
         where tp.paid_on = p_day
      ) x
     where is_admin() or x.loc in (select la.location from location_admins la where la.user_id = current_user_id())
  ), '[]'::jsonb);
end $function$;

-- Права и политики до 0188
grant select, insert, update, delete, truncate on service_payments to service_role;
grant select, insert, update, delete on equipment_orders, equipment_order_lines, equipment_issues, equipment_order_status_history to authenticated;
drop policy if exists equipment_issues_admin_read on equipment_issues;
drop policy if exists service_payments_eq_local_admin_read on service_payments;
drop policy if exists equipment_orders_admin on equipment_orders;
create policy equipment_orders_admin on equipment_orders for all using (is_admin()) with check (is_admin());
drop policy if exists equipment_lines_admin on equipment_order_lines;
create policy equipment_lines_admin on equipment_order_lines for all using (is_admin()) with check (is_admin());
drop policy if exists equipment_issues_admin on equipment_issues;
create policy equipment_issues_admin on equipment_issues for all using (is_admin()) with check (is_admin());

-- Ограничения и поля журнала (метки op старых строк теряются: они выводятся из знака суммы)
alter table service_payments drop constraint if exists service_payments_op_kind_check;
alter table service_payments drop constraint if exists service_payments_op_sign_check;
alter table service_payments drop constraint if exists service_payments_op_check;
drop index if exists service_payments_request_uq;
alter table service_payments drop column if exists op, drop column if exists request_id, drop column if exists note;
commit;
