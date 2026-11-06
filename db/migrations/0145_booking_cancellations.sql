-- Отмена записи родителем, в том числе оплаченной, и финансовые решения администратора (Issue #274, PR 9).
-- Запись родителя по-прежнему удаляется (место освобождается, из долгов, календаря и баллов она исчезает сама),
-- а факт отмены остаётся в booking_cancellations со статусом «Отменена». Оплата в журнале service_payments не меняется.
-- Для оплаченной записи статус «ждёт решения» (awaiting): администратор выбирает одно из трёх действий, ничего автоматически:
--   kept        — оплата остаётся клубу (журнал не меняется);
--   transferred — оплата переносится на другую неоплаченную запись ребёнка (минус на старом занятии, плюс на новом);
--   refunded    — возврат (строка с минусом в журнале).
-- Оплаты без записи в журнале (до 0083) в отчёте не учитывались: для них перенос журнал не трогает, возврат пишется явно.

create table booking_cancellations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  kind text not null check (kind in ('individual', 'goalkeeper', 'extra')),
  session_id uuid not null,                  -- без внешнего ключа: занятие могут удалить, история остаётся
  player_id uuid not null references players(id) on delete cascade,
  starts_at timestamp not null,              -- снимок начала занятия
  label text,                                -- снимок темы или места
  amount numeric(10,2) not null default 0,   -- сколько было оплачено по записи (0 — не оплачена)
  status text not null check (status in ('cancelled', 'awaiting', 'kept', 'transferred', 'refunded')),
  cancelled_at timestamptz not null default now(),
  cancelled_by uuid references users(id),
  decided_at timestamptz,
  decided_by uuid references users(id),
  note text,
  target_kind text check (target_kind is null or target_kind in ('individual', 'goalkeeper', 'extra')),
  target_session_id uuid
);
create index booking_cancellations_awaiting on booking_cancellations (cancelled_at) where status = 'awaiting';
create index booking_cancellations_player on booking_cancellations (player_id, cancelled_at desc);
alter table booking_cancellations enable row level security;
drop policy if exists booking_cancellations_admin_read on booking_cancellations;
create policy booking_cancellations_admin_read on booking_cancellations for select using (is_admin());
revoke all on booking_cancellations from public, anon, authenticated;
grant select on booking_cancellations to authenticated;

-- Отмена родителем: оплаченную тоже можно (до начала, по тем же правилам); запись удаляется, отмена фиксируется.
create or replace function booking_cancel(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st timestamp; was_paid boolean; marked boolean; hrs numeric; now_local timestamp := now() at time zone 'Asia/Tbilisi'; c uuid; amt numeric; lbl text;
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  if k in ('individual', 'goalkeeper') then
    select ses.starts_at, ses.club_id, b.paid, b.attended is not null, case when b.paid then b.amount else 0 end, ses.topic
      into st, c, was_paid, marked, amt, lbl
      from individual_sessions ses join individual_bookings b on b.session_id = ses.id and b.player_id = p
     where ses.id = s and ses.goalkeepers = (k = 'goalkeeper') for update of b;
  elsif k = 'extra' then
    select e.starts_on::timestamp + coalesce(e.starts_time, time '00:00'), e.club_id, b.paid, b.attended is not null, case when b.paid then coalesce(b.paid_amount, e.amount) else 0 end, e.place
      into st, c, was_paid, marked, amt, lbl
      from extra_sessions e join extra_bookings b on b.session_id = e.id and b.player_id = p where e.id = s for update of b;
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  if st is null then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if marked then raise exception 'attendance marked' using errcode = '22023'; end if;
  if st <= now_local then raise exception 'session already started' using errcode = '22023'; end if;
  hrs := coalesce(nullif(regexp_replace(coalesce((select value from club_settings where club_id = c and key = 'booking.cancelHours'), ''), '[^0-9.]', '', 'g'), '')::numeric, 0);
  if hrs > 0 and st - now_local < make_interval(secs => (hrs * 3600)::double precision) then raise exception 'too late' using errcode = '22023'; end if;
  insert into booking_cancellations (club_id, kind, session_id, player_id, starts_at, label, amount, status, cancelled_by)
    values (c, k, s, p, st, lbl, coalesce(amt, 0), case when was_paid then 'awaiting' else 'cancelled' end, current_user_id());
  if k = 'extra' then delete from extra_bookings where session_id = s and player_id = p;
  else delete from individual_bookings where session_id = s and player_id = p; end if;
end $$;
revoke execute on function booking_cancel(text, uuid, uuid) from public, anon;
grant execute on function booking_cancel(text, uuid, uuid) to authenticated;

create or replace function booking_cancellation_assert(c uuid) returns booking_cancellations
language plpgsql security definer set search_path = public as $$
declare r booking_cancellations;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from booking_cancellations where id = c for update;
  if not found then raise exception 'cancellation not found' using errcode = 'P0002'; end if;
  if r.status <> 'awaiting' then raise exception 'already decided' using errcode = '22023'; end if;
  return r;
end $$;
revoke execute on function booking_cancellation_assert(uuid) from public, anon, authenticated;

-- Оставить оплату клубу
create or replace function booking_cancel_keep(c uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r booking_cancellations;
begin
  r := booking_cancellation_assert(c);
  update booking_cancellations set status = 'kept', decided_at = now(), decided_by = current_user_id(), note = nullif(trim(p_note), '') where id = c;
end $$;
revoke execute on function booking_cancel_keep(uuid, text) from public, anon;
grant execute on function booking_cancel_keep(uuid, text) to authenticated;

-- Возврат: строка с минусом в журнале оплат (исходная оплата не меняется)
create or replace function booking_cancel_refund(c uuid, mth text default null, d date default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r booking_cancellations; lk text; orig service_payments; m text;
begin
  r := booking_cancellation_assert(c);
  lk := case when r.kind = 'extra' then 'extra' else 'individual' end;
  orig := service_payment_original(lk, r.session_id, r.player_id);
  m := coalesce(nullif(trim(mth), ''), orig.method);
  perform service_method_ok(m);
  if r.amount > 0 then
    perform service_payment_add(lk, r.session_id, r.player_id, -r.amount, d, m, orig.id);
  end if;
  update booking_cancellations set status = 'refunded', decided_at = now(), decided_by = current_user_id(), note = nullif(trim(p_note), '') where id = c;
end $$;
revoke execute on function booking_cancel_refund(uuid, text, date, text) from public, anon;
grant execute on function booking_cancel_refund(uuid, text, date, text) to authenticated;

-- Куда можно перенести оплату: неоплаченные записи этого ребёнка на занятия, которые ещё не начались, с той же суммой
create or replace function booking_transfer_targets(c uuid) returns table (kind text, session_id uuid, starts_at timestamp, label text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare r booking_cancellations; now_local timestamp := now() at time zone 'Asia/Tbilisi';
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from booking_cancellations where id = c;
  if not found then raise exception 'cancellation not found' using errcode = 'P0002'; end if;
  return query
    select case when s.goalkeepers then 'goalkeeper' else 'individual' end, s.id, s.starts_at, s.topic, b.amount
      from individual_bookings b join individual_sessions s on s.id = b.session_id
     where b.player_id = r.player_id and not b.paid and s.starts_at > now_local and s.club_id = r.club_id and b.amount = r.amount
    union all
    select 'extra', e.id, e.starts_on::timestamp + coalesce(e.starts_time, time '00:00'), e.place, e.amount
      from extra_bookings b join extra_sessions e on e.id = b.session_id
     where b.player_id = r.player_id and not b.paid and e.cancelled_at is null and e.club_id = r.club_id and e.amount = r.amount
       and e.starts_on::timestamp + coalesce(e.starts_time, time '00:00') > now_local
    order by 3;
end $$;
revoke execute on function booking_transfer_targets(uuid) from public, anon;
grant execute on function booking_transfer_targets(uuid) to authenticated;

-- Перенос оплаты на другое занятие (запись на него уже должна быть, неоплаченная, на ту же сумму)
create or replace function booking_cancel_transfer(c uuid, tk text, ts uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r booking_cancellations; lk text; tlk text; orig service_payments; now_local timestamp := now() at time zone 'Asia/Tbilisi';
        tamt numeric; tstart timestamp; tclub uuid;
begin
  r := booking_cancellation_assert(c);
  if tk not in ('individual', 'goalkeeper', 'extra') then raise exception 'bad kind' using errcode = '22023'; end if;
  lk := case when r.kind = 'extra' then 'extra' else 'individual' end;
  tlk := case when tk = 'extra' then 'extra' else 'individual' end;
  if tk in ('individual', 'goalkeeper') then
    select b.amount, s.starts_at, s.club_id into tamt, tstart, tclub
      from individual_bookings b join individual_sessions s on s.id = b.session_id
     where b.session_id = ts and b.player_id = r.player_id and s.goalkeepers = (tk = 'goalkeeper') and not b.paid for update of b;
  else
    select e.amount, e.starts_on::timestamp + coalesce(e.starts_time, time '00:00'), e.club_id into tamt, tstart, tclub
      from extra_bookings b join extra_sessions e on e.id = b.session_id
     where b.session_id = ts and b.player_id = r.player_id and not b.paid and e.cancelled_at is null for update of b;
  end if;
  if tamt is null then raise exception 'target booking not found' using errcode = 'P0002'; end if;
  if tclub <> r.club_id then raise exception 'wrong club' using errcode = '22023'; end if;
  if tstart <= now_local then raise exception 'session already started' using errcode = '22023'; end if;
  if tamt <> r.amount then raise exception 'amount mismatch' using errcode = '22023'; end if;
  orig := service_payment_original(lk, r.session_id, r.player_id);
  if orig.id is not null then
    perform service_payment_add(lk, r.session_id, r.player_id, -r.amount, null, orig.method, orig.id);
    perform service_payment_add(tlk, ts, r.player_id, r.amount, null, orig.method);
  end if;
  if tk = 'extra' then
    update extra_bookings set paid = true, paid_amount = r.amount, method = orig.method where session_id = ts and player_id = r.player_id;
  else
    update individual_bookings set paid = true where session_id = ts and player_id = r.player_id;
  end if;
  update booking_cancellations set status = 'transferred', decided_at = now(), decided_by = current_user_id(), note = nullif(trim(p_note), ''), target_kind = tk, target_session_id = ts where id = c;
end $$;
revoke execute on function booking_cancel_transfer(uuid, text, uuid, text) from public, anon;
grant execute on function booking_cancel_transfer(uuid, text, uuid, text) to authenticated;

-- Отмена дополнительной тренировки клубом: записи переходят в booking_cancellations (оплаченные ждут решения админа,
-- неоплаченные — «Отменена»), оплаты в журнале не меняются. Записи с уже стоящей отметкой посещения остаются как были.
create or replace function extra_cancel_session(s uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; n int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  update extra_sessions set cancelled_at = clock_timestamp(), cancelled_by = current_user_id(), cancel_reason = nullif(trim(p_reason), '') where id = s;
  insert into booking_cancellations (club_id, kind, session_id, player_id, starts_at, label, amount, status, cancelled_by)
    select ses.club_id, 'extra', s, b.player_id, ses.starts_on::timestamp + coalesce(ses.starts_time, time '00:00'), ses.place,
           case when b.paid then coalesce(b.paid_amount, ses.amount) else 0 end, case when b.paid then 'awaiting' else 'cancelled' end, current_user_id()
      from extra_bookings b where b.session_id = s and b.attended is null;
  get diagnostics n = row_count;
  delete from extra_bookings where session_id = s and attended is null;
  perform extra_log(s, 'cancelled', jsonb_build_object('reason', nullif(trim(p_reason), ''), 'bookings', n));
end $$;
revoke execute on function extra_cancel_session(uuid, text) from public, anon;
grant execute on function extra_cancel_session(uuid, text) to authenticated;
