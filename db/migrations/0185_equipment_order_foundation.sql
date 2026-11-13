-- 0185 (#471 PR-1): основа заказа экипировки перед самозаказом родителей.
-- Условия: docs/acceptance/eq-471-pr1-foundation-2026-11-12.md. План: tech-plan-471-v5, разделы 2.4, 5, 9.
-- 1) Колонки заказа: created_at, created_by, source, request_id, поля отмены и восстановления.
-- 2) Статусы new («Новый») и cancelled («Отменён») в CHECK заказа и истории; старые заказы сохраняют статус.
-- 3) Журнал событий equipment_order_events (только добавление).
-- 4) Отмена eq_cancel_order и восстановление eq_restore_order (только глобальный администратор); paid и service_payments не меняются.
-- 5) Защита отменённого заказа: строки, выдача и поля заказа заморожены, paid не растёт, автостатус по выдаче его не трогает,
--    перевести в cancelled и обратно можно только этими функциями.
-- 6) eq_order_due / eq_order_overpaid; parent_dues, eq_number_taken, eq_delete_order учитывают отмену.
-- Скидка (PR-5) и журнал оплат (PR-2) не меняются. Тела функций пересобраны из определений текущего master (0133, 0178 и др.).

-- 1. Колонки. Авторы без внешнего ключа на users: удаление пользователя (например, erase_parent) не должно упираться в заказы
-- и не может обнулять неизменяемые поля (триггер защиты ниже).
alter table equipment_orders
  add column if not exists created_at timestamptz,
  add column if not exists created_by uuid,
  add column if not exists source text not null default 'admin',
  add column if not exists request_id uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid,
  add column if not exists cancel_reason text,
  add column if not exists status_before_cancel text,
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by uuid;

-- Старые заказы: время создания = полночь Тбилиси даты заказа, без даты 2000-01-01; источник import для заказов из таблицы.
update equipment_orders
   set created_at = coalesce((ordered_on::timestamp at time zone 'Asia/Tbilisi'), timestamptz '2000-01-01 00:00:00+04')
 where created_at is null;
update equipment_orders set source = 'import' where external_ord_id is not null and source = 'admin';
alter table equipment_orders alter column created_at set default now(), alter column created_at set not null;

alter table equipment_orders drop constraint if exists equipment_orders_source_check;
alter table equipment_orders add constraint equipment_orders_source_check check (source in ('admin', 'parent', 'import'));
create unique index if not exists equipment_orders_request_uq on equipment_orders (created_by, request_id) where request_id is not null;

-- 2. Статусы
alter table equipment_orders drop constraint if exists equipment_orders_status_check;
alter table equipment_orders add constraint equipment_orders_status_check
  check (status in ('new', 'accepted', 'sewing', 'ready', 'issued', 'cancelled'));
alter table equipment_order_status_history drop constraint if exists equipment_order_status_history_status_check;
alter table equipment_order_status_history add constraint equipment_order_status_history_status_check
  check (status in ('new', 'accepted', 'sewing', 'ready', 'issued', 'cancelled'));
alter table equipment_orders drop constraint if exists equipment_orders_cancel_check;
alter table equipment_orders add constraint equipment_orders_cancel_check check (
  (status = 'cancelled') = (cancelled_at is not null and status_before_cancel is not null)
  and (status_before_cancel is null or status_before_cancel in ('new', 'accepted', 'sewing', 'ready', 'issued'))
);

-- 3. Журнал событий заказа. Без внешнего ключа на users: удаление пользователя не должно править журнал.
create table if not exists equipment_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references equipment_orders(id),
  event text not null check (event in ('cancel', 'restore')),
  reason text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text
);
create index if not exists equipment_order_events_order_idx on equipment_order_events (order_id, id);

create or replace function eq_events_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'equipment_order_events is append-only' using errcode = '42501';
end $$;
revoke execute on function eq_events_append_only() from public, anon, authenticated;
drop trigger if exists equipment_order_events_immutable on equipment_order_events;
create trigger equipment_order_events_immutable before update or delete on equipment_order_events
  for each row execute function eq_events_append_only();
drop trigger if exists equipment_order_events_no_truncate on equipment_order_events;
create trigger equipment_order_events_no_truncate before truncate on equipment_order_events
  for each statement execute function eq_events_append_only();

alter table equipment_order_events enable row level security;
drop policy if exists equipment_order_events_read on equipment_order_events;
create policy equipment_order_events_read on equipment_order_events for select using (
  is_admin() or exists (select 1 from equipment_orders o where o.id = order_id and is_location_admin(o.location))
);
revoke all on equipment_order_events from public, anon, authenticated, service_role;
grant select on equipment_order_events to authenticated, service_role;

-- 5. Защита заказа: автор и время создания неизменны, отмена только функциями, отменённый заказ заморожен.
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
end $$;
revoke execute on function eq_orders_guard() from public, anon, authenticated;
drop trigger if exists equipment_orders_guard on equipment_orders;
create trigger equipment_orders_guard before insert or update on equipment_orders
  for each row execute function eq_orders_guard();

-- Строки и выдача отменённого заказа не меняются (каскадное удаление заказа проходит: строки заказа уже нет).
create or replace function eq_cancelled_freeze() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from equipment_orders o
              where o.id in (new.order_id, old.order_id) and o.status = 'cancelled') then
    raise exception 'order cancelled' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function eq_cancelled_freeze() from public, anon, authenticated;
drop trigger if exists equipment_lines_cancelled_freeze on equipment_order_lines;
create trigger equipment_lines_cancelled_freeze before insert or update or delete on equipment_order_lines
  for each row execute function eq_cancelled_freeze();
drop trigger if exists equipment_issues_cancelled_freeze on equipment_issues;
create trigger equipment_issues_cancelled_freeze before insert or update or delete on equipment_issues
  for each row execute function eq_cancelled_freeze();

-- Автостатус по выдаче (0133): отменённый заказ не трогается.
create or replace function eq_sync_status_with_issues() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  oid uuid := coalesce(new.order_id, old.order_id);
  eo equipment_orders;
  target text;
begin
  select * into eo from equipment_orders where id = oid for update;
  if not found then return null; end if; -- заказ удаляется каскадом
  if eo.status = 'cancelled' then return null; end if;
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
end $$;
revoke execute on function eq_sync_status_with_issues() from public, anon, authenticated;

-- Ручная смена статуса (0133 + «Новый»): вперёд на шаг админ и локальный админ, назад на шаг только админ, в «Новый» не возвращается.
create or replace function eq_set_order_status(o uuid, st text) returns void
language plpgsql security definer set search_path = public as $$
declare
  eo equipment_orders;
  steps text[] := array['new', 'accepted', 'sewing', 'ready', 'issued'];
  cur int;
  nxt int;
begin
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not (is_admin() or is_location_admin(eo.location)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if eo.status = 'cancelled' then raise exception 'order cancelled' using errcode = '22023'; end if;
  cur := array_position(steps, eo.status);
  nxt := array_position(steps, st);
  if nxt is null then raise exception 'bad status' using errcode = '22023'; end if;
  if abs(nxt - cur) <> 1 or st = 'new' then raise exception 'bad transition' using errcode = '22023'; end if;
  if nxt < cur and not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if st = 'issued' and not eq_all_kits_issued(o) then raise exception 'not all issued' using errcode = '22023'; end if;
  update equipment_orders set status = st where id = o;
  insert into equipment_order_status_history (order_id, status, changed_by, changed_by_name)
  values (o, st, current_user_id(), (select display_name from users where id = current_user_id()));
end $$;

-- 4. Отмена: только глобальный администратор, любой этап, причина обязательна. Платежи и суммы не меняются.
create or replace function eq_cancel_order(o uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  eo equipment_orders;
  uid uuid := current_user_id();
  who text := (select display_name from users where id = current_user_id());
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if eo.status = 'cancelled' then raise exception 'already cancelled' using errcode = '22023'; end if;
  if nullif(trim(reason), '') is null then raise exception 'reason required' using errcode = '22023'; end if;
  perform set_config('eq.op', 'cancel', true);
  update equipment_orders
     set status = 'cancelled', status_before_cancel = eo.status, cancelled_at = now(), cancelled_by = uid, cancel_reason = trim(reason)
   where id = o;
  perform set_config('eq.op', '', true);
  insert into equipment_order_status_history (order_id, status, changed_by, changed_by_name) values (o, 'cancelled', uid, who);
  insert into equipment_order_events (order_id, event, reason, data, created_by, created_by_name)
  values (o, 'cancel', trim(reason),
          jsonb_build_object('from_status', eo.status, 'to_status', 'cancelled', 'paid', eo.paid, 'total', eo.total), uid, who);
end $$;

-- Восстановление (F1): только глобальный администратор, статус возвращается к прежнему.
create or replace function eq_restore_order(o uuid, note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  eo equipment_orders;
  uid uuid := current_user_id();
  who text := (select display_name from users where id = current_user_id());
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if eo.status <> 'cancelled' then raise exception 'not cancelled' using errcode = '22023'; end if;
  perform set_config('eq.op', 'restore', true);
  update equipment_orders
     set status = eo.status_before_cancel, status_before_cancel = null, cancelled_at = null, cancelled_by = null, cancel_reason = null,
         restored_at = now(), restored_by = uid
   where id = o;
  perform set_config('eq.op', '', true);
  insert into equipment_order_status_history (order_id, status, changed_by, changed_by_name) values (o, eo.status_before_cancel, uid, who);
  insert into equipment_order_events (order_id, event, reason, data, created_by, created_by_name)
  values (o, 'restore', nullif(trim(note), ''),
          jsonb_build_object('from_status', 'cancelled', 'to_status', eo.status_before_cancel, 'paid', eo.paid, 'total', eo.total,
                             'cancelled_at', eo.cancelled_at, 'cancel_reason', eo.cancel_reason), uid, who);
end $$;

revoke execute on function eq_cancel_order(uuid, text), eq_restore_order(uuid, text) from public, anon;
grant execute on function eq_cancel_order(uuid, text), eq_restore_order(uuid, text) to authenticated;

-- Удаление (0036 + D5): заказ родителя и заказ с событиями не удаляются.
create or replace function eq_delete_order(o uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform eq_assert_admin();
  if exists (select 1 from equipment_orders where id = o and source = 'parent') then raise exception 'parent order' using errcode = '22023'; end if;
  if exists (select 1 from equipment_order_events where order_id = o) then raise exception 'order has events' using errcode = '22023'; end if;
  if exists (select 1 from equipment_orders where id = o and paid > 0) then raise exception 'order has payments' using errcode = '22023'; end if;
  if exists (select 1 from equipment_issues where order_id = o) then raise exception 'order has issues' using errcode = '22023'; end if;
  delete from equipment_orders where id = o;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
end $$;

-- 6. К оплате и переплата (права вызывающего; доступны как вычисляемые поля: select=*,eq_order_due,eq_order_overpaid).
create or replace function eq_order_due(e equipment_orders) returns numeric
language sql stable set search_path = public as $$
  select case when e.status = 'cancelled' then 0 else greatest(e.total - e.paid, 0) end
$$;
create or replace function eq_order_overpaid(e equipment_orders) returns numeric
language sql stable set search_path = public as $$
  select case when e.status = 'cancelled' then e.paid else greatest(e.paid - e.total, 0) end
$$;
revoke execute on function eq_order_due(equipment_orders), eq_order_overpaid(equipment_orders) from public, anon;
grant execute on function eq_order_due(equipment_orders), eq_order_overpaid(equipment_orders) to authenticated, service_role;

-- Номер на отменённом заказе не занимает номер.
create or replace function eq_number_taken(o uuid, p uuid, n text) returns boolean
language sql stable security definer set search_path = public as $$
  select eq_num_norm(n) is not null and exists (
    select 1 from equipment_orders eo
    join players pl on pl.id = eo.player_id
    join groups g on g.id = pl.group_id
    where eo.id is distinct from o and eo.player_id is distinct from p
      and eo.status <> 'cancelled'
      and eq_num_norm(eo.number) = eq_num_norm(n)
      and regexp_replace(lower(g.name), '-.*$', '') = (select regexp_replace(lower(g2.name), '-.*$', '') from players p2 join groups g2 on g2.id = p2.group_id where p2.id = p))
$$;

-- parent_dues (тело 0178): отменённый заказ без оплат не показывается, с оплатой: «Отменён: …», к оплате и долг 0.
create or replace function parent_dues()
returns table(player_id uuid, kind text, title text, on_date date, due numeric, paid numeric, debt numeric)
language plpgsql stable security definer set search_path = public as $$
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
         case when o.status = 'cancelled' then 'Отменён: ' else '' end
           || coalesce((select string_agg(l.kit, ' + ' order by l.kit) from equipment_order_lines l where l.order_id = o.id), 'Экипировка'),
         o.ordered_on,
         case when o.status = 'cancelled' then 0 else o.total end,
         o.paid,
         case when o.status = 'cancelled' then 0 else greatest(o.total - o.paid, 0) end
  from equipment_orders o join kids k on k.pid = o.player_id
  where o.status <> 'cancelled' or o.paid > 0
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
end $$;
