-- 0085 (#321, вариант 1): локальные админы по локациям. Глобальный is_admin() не меняется.
-- Локальный админ видит и ведёт только кассу своих локаций: платежи абонемента, экипировку, сборы, доп. занятия,
-- игроков, группы и абонементы этих локаций. Всё остальное закрыто по умолчанию: индивидуальные занятия (нет локации),
-- долги, тарифы, турниры, матчи, пользователи, роли, аудит, импорт — только у глобального администратора.
-- Выдача прав — отдельная запись в location_admins, которую делает владелец. Миграция прав никому не выдаёт.

create table location_admins (
  user_id uuid not null references users(id) on delete cascade,
  location text not null check (length(trim(location)) > 0),
  primary key (user_id, location)
);
alter table location_admins enable row level security;
drop policy if exists location_admins_admin on location_admins;
create policy location_admins_admin on location_admins for all using (is_admin()) with check (is_admin());
revoke all on location_admins from anon, authenticated;
grant select, insert, delete on location_admins to authenticated;

-- Вспомогательные функции. Вызываются из политик RLS, поэтому доступны вошедшим пользователям; данные — только по своему id.
create or replace function is_location_admin(loc text) returns boolean
language sql stable security definer set search_path = public as $$
  select loc is not null and exists (select 1 from location_admins la where la.user_id = current_user_id() and la.location = loc)
$$;

create or replace function has_location_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from location_admins la where la.user_id = current_user_id())
$$;

create or replace function group_location(g uuid) returns text
language sql stable security definer set search_path = public as $$
  select gr.location from groups gr where gr.id = g
$$;

create or replace function player_location(pid uuid) returns text
language sql stable security definer set search_path = public as $$
  select gr.location from players pl join groups gr on gr.id = pl.group_id where pl.id = pid
$$;

create or replace function camp_location(c uuid) returns text
language sql stable security definer set search_path = public as $$
  select cm.location from camps cm where cm.id = c
$$;

create or replace function extra_place(s uuid) returns text
language sql stable security definer set search_path = public as $$
  select es.place from extra_sessions es where es.id = s
$$;

revoke execute on function is_location_admin(text), has_location_admin(), group_location(uuid), player_location(uuid),
  camp_location(uuid), extra_place(uuid) from public, anon;
grant execute on function is_location_admin(text), has_location_admin(), group_location(uuid), player_location(uuid),
  camp_location(uuid), extra_place(uuid) to authenticated;

-- Свои локации для интерфейса (подсказка; права проверяет база). Только список собственных локаций.
create or replace function my_locations() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(la.location order by la.location), '{}'::text[]) from location_admins la where la.user_id = current_user_id()
$$;
revoke execute on function my_locations() from public, anon;
grant execute on function my_locations() to authenticated;

-- Чтение для локального админа (политики добавляются к существующим: доступ открывается только по своей локации).
create policy players_location_read on players for select using (is_location_admin(group_location(group_id)));
create policy groups_location_read on groups for select using (is_location_admin(location));
create policy subscriptions_location_read on subscriptions for select using (is_location_admin(group_location(group_id)));
create policy payments_location_read on payments for select using (is_location_admin(player_location(player_id)));
create policy payments_location_insert on payments for insert with check (is_location_admin(player_location(player_id)));
create policy camp_participants_location_read on camp_participants for select using (is_location_admin(camp_location(camp_id)));
create policy camp_payments_location_read on camp_payments for select using (is_location_admin(camp_location(camp_id)));
create policy equipment_orders_location_read on equipment_orders for select using (is_location_admin(location));
create policy equipment_lines_location_read on equipment_order_lines for select
  using (exists (select 1 from equipment_orders eo where eo.id = order_id and is_location_admin(eo.location)));
create policy extra_sessions_location_read on extra_sessions for select using (is_location_admin(place));
create policy extra_bookings_location_read on extra_bookings for select using (is_location_admin(extra_place(session_id)));

-- Экипировка: оплата заказа своей локации (остальное — как в 0083).
create or replace function eq_add_payment(o uuid, amt numeric, d date default null, mth text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; np numeric;
begin
  if not (is_admin() or has_location_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not is_admin() and not is_location_admin(eo.location) then raise exception 'forbidden' using errcode = '42501'; end if;
  if amt is null or amt = 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  perform service_method_ok(mth);
  np := eo.paid + amt;
  if np < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  if np > eo.total then raise exception 'paid above total' using errcode = '22023'; end if;
  update equipment_orders set paid = np where id = o;
  perform service_payment_add('equipment', o, eo.player_id, amt, d, mth);
  return np;
end $$;

-- Сборы: оплата и отмена участника своего сбора.
create or replace function camp_pay(pid uuid, amt numeric, k text, d date, mth text, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cp camp_participants; r uuid;
begin
  if not (is_admin() or has_location_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into cp from camp_participants where id = pid;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if not is_admin() and not is_location_admin(camp_location(cp.camp_id)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if k not in ('booking', 'payment') then raise exception 'bad kind' using errcode = '22023'; end if;
  if amt is null or amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, method, comment)
  values (cp.camp_id, pid, cp.player_id, amt, coalesce(d, current_date), k, nullif(trim(mth), ''), nullif(trim(cmt), ''))
  returning id into r;
  return r;
end $$;

create or replace function camp_cancel_payment(payid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p camp_payments; total numeric;
begin
  if not (is_admin() or has_location_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from camp_payments where id = payid;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if not is_admin() and not is_location_admin(camp_location(p.camp_id)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p.kind = 'refund' or p.amount <= 0 then raise exception 'not cancellable' using errcode = '22023'; end if;
  if exists (select 1 from camp_payments where legacy_ref = 'cancel:' || payid) then raise exception 'already cancelled' using errcode = '23505'; end if;
  select coalesce(sum(amount), 0) into total from camp_payments where participant_id = p.participant_id;
  if total - p.amount < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, method, comment, legacy_ref)
  values (p.camp_id, p.participant_id, p.player_id, -p.amount, current_date, 'refund', p.method, 'Отмена платежа', 'cancel:' || payid);
end $$;

-- Доп. тренировка: оплата и отмена занятия своего места (остальное — как в 0083).
create or replace function extra_set_paid(s uuid, p uuid, is_paid boolean, mth text default null, amt numeric default null, d date default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; b extra_bookings; orig service_payments; got numeric;
begin
  if not (is_admin() or has_location_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s;
  select * into b from extra_bookings where session_id = s and player_id = p for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if not is_admin() and not is_location_admin(ses.place) then raise exception 'forbidden' using errcode = '42501'; end if;
  if is_paid then
    if amt is not null and amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
    if b.paid then return; end if;
    perform service_method_ok(mth);
    got := coalesce(amt, ses.amount);
    update extra_bookings set paid = true, paid_amount = got, method = trim(mth) where session_id = s and player_id = p;
    if got <> 0 then perform service_payment_add('extra', s, p, got, d, mth); end if;
  else
    if not b.paid then return; end if;
    orig := service_payment_original('extra', s, p);
    update extra_bookings set paid = false, paid_amount = null, method = null where session_id = s and player_id = p;
    if orig.id is not null then
      perform service_payment_add('extra', s, p, -orig.amount, d, orig.method, orig.id);
    end if;
  end if;
end $$;

-- Кассовый отчёт: глобальный админ — всё; локальный — только строки своих локаций (остальное — как в 0084).
create or replace function cash_report(
  p_from date, p_to date,
  p_location text default null, p_staff uuid default null, p_method text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
    select case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' else 'Доп. занятие' end,
           sp.id, sp.player_id, sp.amount, sp.paid_on, sp.method, sp.recorded_by, sp.recorded_at,
           case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                        when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id) end
      from service_payments sp
  ), rows_f as (
    select s.*, case when s.method in ('Наличные', 'Перевод') then s.method else 'не указан' end as method_key
      from src s
     where s.paid_on between p_from and p_to
       and (p_location is null or s.location = p_location)
       and (p_staff is null or s.recorded_by = p_staff)
       and (is_admin() or s.location in (select la.location from location_admins la where la.user_id = current_user_id()))
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
end $$;
