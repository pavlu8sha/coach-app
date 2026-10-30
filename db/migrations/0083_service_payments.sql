-- 0083 (#322): журнал оплат экипировки, индивидуальных и дополнительных занятий для кассового отчёта.
-- Записи вперёд: новые оплаты пишутся сюда вместе с отметкой «оплачено» в прежних таблицах.
-- Исторические отметки «оплачено» (импорт, до этой миграции) сюда не переносятся: в отчёте они не учитываются.
-- Способ обязателен для новых записей («Наличные» или «Перевод»). Отмена — строка с минусом, способ берётся от исходной оплаты.
-- Автор и время ставит сервер (триггер из 0077). Журнал только добавляется: писать его могут только функции ниже.

create table service_payments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('equipment', 'individual', 'extra')),
  ref_id uuid not null,                       -- equipment_orders.id, individual_sessions.id или extra_sessions.id
  player_id uuid not null references players(id) on delete cascade,
  amount numeric(10,2) not null check (amount <> 0),
  paid_on date not null,
  method text check (method is null or method in ('Наличные', 'Перевод')),
  cancels uuid unique references service_payments(id),
  recorded_by uuid references users(id),
  recorded_at timestamptz,
  created_at timestamptz not null default now()
);
create index service_payments_ref_idx on service_payments (kind, ref_id, player_id);

alter table service_payments enable row level security;
drop policy if exists service_payments_admin_read on service_payments;
create policy service_payments_admin_read on service_payments for select using (is_admin());
grant select on service_payments to authenticated;
revoke insert, update, delete on service_payments from authenticated, anon;

drop trigger if exists service_payments_stamp_author on service_payments;
create trigger service_payments_stamp_author before insert on service_payments for each row execute function stamp_payment_author();
drop trigger if exists service_payments_guard_author on service_payments;
create trigger service_payments_guard_author before update on service_payments for each row execute function guard_payment_author();

-- Способ допускается только из двух значений.
create or replace function service_method_ok(mth text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if trim(coalesce(mth, '')) not in ('Наличные', 'Перевод') then raise exception 'bad method' using errcode = '22023'; end if;
end $$;

-- Одна запись в журнале. Вызывается только из функций ниже (они security definer).
create or replace function service_payment_add(k text, ref uuid, pl uuid, amt numeric, d date, mth text, cancels_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, cancels)
  values (k, ref, pl, amt, coalesce(d, tbilisi_day(now())), trim(mth), cancels_id)
  returning id into r;
  return r;
end $$;

-- Исходная положительная оплата, которую ещё не отменили: её способ и сумма переходят в отмену.
create or replace function service_payment_original(k text, ref uuid, pl uuid) returns service_payments
language sql stable security definer set search_path = public as $$
  select sp.* from service_payments sp
   where sp.kind = k and sp.ref_id = ref and sp.player_id = pl and sp.amount > 0
     and not exists (select 1 from service_payments c where c.cancels = sp.id)
   order by sp.created_at desc limit 1
$$;

revoke execute on function service_method_ok(text), service_payment_add(text, uuid, uuid, numeric, date, text, uuid),
  service_payment_original(text, uuid, uuid) from public, anon, authenticated;

-- Экипировка: оплата или исправление суммой (минус). Журнал пишется вместе с суммой заказа.
drop function if exists eq_add_payment(uuid, numeric);
create or replace function eq_add_payment(o uuid, amt numeric, d date default null, mth text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; np numeric;
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if amt is null or amt = 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  perform service_method_ok(mth);
  np := eo.paid + amt;
  if np < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  if np > eo.total then raise exception 'paid above total' using errcode = '22023'; end if;
  update equipment_orders set paid = np where id = o;
  perform service_payment_add('equipment', o, eo.player_id, amt, d, mth);
  return np;
end $$;
revoke execute on function eq_add_payment(uuid, numeric, date, text) from public, anon;
grant execute on function eq_add_payment(uuid, numeric, date, text) to authenticated;

-- Индивидуальное занятие: оплата полной суммой записи; отмена оплаты пишет минус от исходной оплаты.
drop function if exists ind_set_paid(uuid, uuid, boolean);
create or replace function ind_set_paid(s uuid, p uuid, is_paid boolean, mth text default null, d date default null) returns void
language plpgsql security definer set search_path = public as $$
declare b individual_bookings; orig service_payments;
begin
  perform ind_assert_admin();
  select * into b from individual_bookings where session_id = s and player_id = p for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if coalesce(is_paid, false) then
    if b.paid then return; end if;
    perform service_method_ok(mth);
    update individual_bookings set paid = true where session_id = s and player_id = p;
    if b.amount <> 0 then perform service_payment_add('individual', s, p, b.amount, d, mth); end if;
  else
    if not b.paid then return; end if;
    orig := service_payment_original('individual', s, p);
    update individual_bookings set paid = false where session_id = s and player_id = p;
    if orig.id is not null then
      perform service_payment_add('individual', s, p, -orig.amount, d, orig.method, orig.id);
    end if;
  end if;
end $$;
revoke execute on function ind_set_paid(uuid, uuid, boolean, text, date) from public, anon;
grant execute on function ind_set_paid(uuid, uuid, boolean, text, date) to authenticated;

-- Доп. тренировка: оплата с суммой (по умолчанию цена занятия); отмена пишет минус от исходной оплаты.
drop function if exists extra_set_paid(uuid, uuid, boolean, text, numeric);
create or replace function extra_set_paid(s uuid, p uuid, is_paid boolean, mth text default null, amt numeric default null, d date default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; b extra_bookings; orig service_payments; got numeric;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s;
  select * into b from extra_bookings where session_id = s and player_id = p for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
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
revoke execute on function extra_set_paid(uuid, uuid, boolean, text, numeric, date) from public, anon;
grant execute on function extra_set_paid(uuid, uuid, boolean, text, numeric, date) to authenticated;
