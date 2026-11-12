-- Откат миграции 0185 (#471 PR-1). Запускать только по решению владельца, в SQL Editor целиком, в одной транзакции.
-- Возвращает определения функций, какими они были до 0185 (снимок pg_get_functiondef на master 92b8521 с 0178),
-- удаляет журнал событий заказов, триггеры защиты, новые колонки и статусы new/cancelled.
-- Откат отказывается работать, если есть заказы в статусах new или cancelled либо записи в журнале событий:
-- их сначала разбирает владелец (восстановить отменённые через eq_restore_order, «Новые» принять). Платежи не трогаются.
begin;
do $$
begin
  if exists (select 1 from equipment_orders where status in ('new', 'cancelled')) then
    raise exception 'rollback 0185: есть заказы в статусе new или cancelled, сначала разобрать вручную';
  end if;
  if to_regclass('equipment_order_events') is not null and exists (select 1 from equipment_order_events) then
    raise exception 'rollback 0185: журнал событий заказов не пуст (были отмены), откат удалил бы историю; решение владельца';
  end if;
end $$;

drop trigger if exists equipment_orders_guard on equipment_orders;
drop trigger if exists equipment_lines_cancelled_freeze on equipment_order_lines;
drop trigger if exists equipment_issues_cancelled_freeze on equipment_issues;
drop function if exists eq_orders_guard();
drop function if exists eq_cancelled_freeze();
drop function if exists eq_cancel_order(uuid, text);
drop function if exists eq_restore_order(uuid, text);
drop function if exists eq_order_due(equipment_orders);
drop function if exists eq_order_overpaid(equipment_orders);
drop table if exists equipment_order_events;
drop function if exists eq_events_append_only();

CREATE OR REPLACE FUNCTION public.parent_dues()
 RETURNS TABLE(player_id uuid, kind text, title text, on_date date, due numeric, paid numeric, debt numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare local_now timestamp := now() at time zone 'Asia/Tbilisi'; today date := (now() at time zone 'Asia/Tbilisi')::date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
  with kids as (
    select pl.id pid
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.user_id = current_user_id() and parent_access_ok(pg.user_id, pg.player_id)
    where pl.status = 'active'
      and exists (select 1 from club_settings cs where cs.club_id = pl.club_id and cs.key = 'parent_debt_enabled' and cs.value = 'true')
  )
  select o.player_id, 'eq'::text,
         coalesce((select string_agg(l.kit, ' + ' order by l.kit) from equipment_order_lines l where l.order_id = o.id), 'Экипировка'),
         o.ordered_on, o.total, o.paid, greatest(o.total - o.paid, 0)
  from equipment_orders o join kids k on k.pid = o.player_id
  union all
  select b.player_id, 'ind'::text, case when s.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end,
         s.starts_at::date, b.amount, case when b.paid then b.amount else 0 end, case when b.paid then 0 else b.amount end
  from individual_bookings b join individual_sessions s on s.id = b.session_id join kids k on k.pid = b.player_id
  where s.starts_at < local_now
  union all
  select b.player_id, 'extra'::text, 'Дополнительная тренировка' || coalesce(', ' || s.place, ''),
         s.starts_on, s.amount, case when b.paid then coalesce(b.paid_amount, s.amount) else 0 end,
         case when b.paid then greatest(s.amount - coalesce(b.paid_amount, s.amount), 0) else s.amount end
  from extra_bookings b join extra_sessions s on s.id = b.session_id join kids k on k.pid = b.player_id
  where s.starts_on <= today and s.cancelled_at is null
  union all
  select g.player_id, 'visit'::text, 'Разовое посещение: ' || gr.name, tbilisi_day(s.starts_at), g.amount,
         case when g.paid then coalesce(g.paid_amount, g.amount) else 0 end,
         case when g.paid then greatest(g.amount - coalesce(g.paid_amount, g.amount), 0) else g.amount end
  from session_guests g join sessions s on s.id = g.session_id join groups gr on gr.id = s.group_id join kids k on k.pid = g.player_id
  where tbilisi_day(s.starts_at) <= today
  union all
  select cp.player_id, 'camp'::text, c.name, c.starts_on, cp.amount, coalesce(pm.amt, 0), greatest(cp.amount - coalesce(pm.amt, 0), 0)
  from camp_participants cp join camps c on c.id = cp.camp_id join kids k on k.pid = cp.player_id
  left join lateral (select sum(x.amount) amt from camp_payments x where x.participant_id = cp.id) pm on true
  where cp.status = 'registered'
  order by 4 desc;
end $function$;

CREATE OR REPLACE FUNCTION public.eq_set_order_status(o uuid, st text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  eo equipment_orders;
  steps text[] := array['accepted', 'sewing', 'ready', 'issued'];
  cur int;
  nxt int;
begin
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not (is_admin() or is_location_admin(eo.location)) then raise exception 'forbidden' using errcode = '42501'; end if;
  cur := array_position(steps, eo.status);
  nxt := array_position(steps, st);
  if nxt is null then raise exception 'bad status' using errcode = '22023'; end if;
  if abs(nxt - cur) <> 1 then raise exception 'bad transition' using errcode = '22023'; end if;
  if nxt < cur and not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if st = 'issued' and not eq_all_kits_issued(o) then raise exception 'not all issued' using errcode = '22023'; end if;
  update equipment_orders set status = st where id = o;
  insert into equipment_order_status_history (order_id, status, changed_by, changed_by_name)
  values (o, st, current_user_id(), (select display_name from users where id = current_user_id()));
end $function$;

CREATE OR REPLACE FUNCTION public.eq_sync_status_with_issues()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  oid uuid := coalesce(new.order_id, old.order_id);
  eo equipment_orders;
  target text;
begin
  select * into eo from equipment_orders where id = oid for update;
  if not found then return null; end if; -- заказ удаляется каскадом
  if eq_all_kits_issued(oid) and eo.status <> 'issued' then
    target := 'issued';
  elsif not eq_all_kits_issued(oid) and eo.status = 'issued' then
    target := 'ready';
  else
    return null;
  end if;
  update equipment_orders set status = target where id = oid;
  insert into equipment_order_status_history (order_id, status, changed_by, changed_by_name)
  values (oid, target, current_user_id(), (select display_name from users where id = current_user_id()));
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.eq_delete_order(o uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform eq_assert_admin();
  if exists (select 1 from equipment_orders where id = o and paid > 0) then raise exception 'order has payments' using errcode = '22023'; end if;
  if exists (select 1 from equipment_issues where order_id = o) then raise exception 'order has issues' using errcode = '22023'; end if;
  delete from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.eq_number_taken(o uuid, p uuid, n text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select eq_num_norm(n) is not null and exists (
    select 1 from equipment_orders eo
    join players pl on pl.id = eo.player_id
    join groups g on g.id = pl.group_id
    where eo.id is distinct from o and eo.player_id is distinct from p
      and eq_num_norm(eo.number) = eq_num_norm(n)
      and regexp_replace(lower(g.name), '-.*$', '') = (select regexp_replace(lower(g2.name), '-.*$', '') from players p2 join groups g2 on g2.id = p2.group_id where p2.id = p))
$function$;

alter table equipment_orders drop constraint if exists equipment_orders_cancel_check;
alter table equipment_orders drop constraint if exists equipment_orders_source_check;
alter table equipment_orders drop constraint if exists equipment_orders_status_check;
alter table equipment_orders add constraint equipment_orders_status_check check (status in ('accepted', 'sewing', 'ready', 'issued'));
alter table equipment_order_status_history drop constraint if exists equipment_order_status_history_status_check;
delete from equipment_order_status_history where status in ('new', 'cancelled');
alter table equipment_order_status_history add constraint equipment_order_status_history_status_check check (status in ('accepted', 'sewing', 'ready', 'issued'));
drop index if exists equipment_orders_request_uq;
alter table equipment_orders
  drop column if exists created_at, drop column if exists created_by, drop column if exists source, drop column if exists request_id,
  drop column if exists cancelled_at, drop column if exists cancelled_by, drop column if exists cancel_reason,
  drop column if exists status_before_cancel, drop column if exists restored_at, drop column if exists restored_by;
commit;
