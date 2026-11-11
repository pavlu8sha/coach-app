-- Уведомление администратору после отмены записи родителем (Issue #556, продолжение #274).
-- booking_cancel() (0145) сохраняла отмену и удаляла запись, но не ставила уведомление. Теперь после удаления ставится одно
-- уведомление администраторам (enqueue_to_admins, вид booking) с именем ребёнка и занятием (вид, дата, время). Оно подчиняется клубному выключателю booking.notify,
-- как и остальные уведомления о записи. Родителю при отмене ничего не уходит. Ошибка отмены откатывает и уведомление.
-- Исправлен текст уведомления о новой записи в booking_signup (0148): раздел называется «Индивидуальные».
-- Ничего не включается: booking.notify не меняется. Условия: docs/BOOKING_CANCEL_NOTICE_ACCEPTANCE.md.

create or replace function booking_cancel(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st timestamp; was_paid boolean; marked boolean; hrs numeric; now_local timestamp := now() at time zone 'Asia/Tbilisi'; c uuid; amt numeric; lbl text; nm text; lbl2 text;
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
  -- админу: только после успешной отмены (при ошибке выше до этого места не доходим, а транзакция откатывается целиком)
  if booking_notify_enabled(c) then
    select full_name into nm from players where id = p;
    -- какое занятие отменили: вид, дата и время (для дополнительной без времени так и пишем, время не придумываем)
    lbl2 := booking_session_label(k, s)
            || case when k = 'extra' and exists (select 1 from extra_sessions e where e.id = s and e.starts_time is null) then ', время не задано' else '' end;
    perform enqueue_to_admins('booking', 'Отмена записи на занятие: ' || coalesce(nm, '—') || ', ' || lbl2 || '. Откройте приложение: Ещё → Индивидуальные.');
  end if;
end $$;

create or replace function booking_signup(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ex extra_sessions; now_local timestamp := now() at time zone 'Asia/Tbilisi'; nm text; cap int; st text;
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  select full_name, status into nm, st from players where id = p;
  if st is distinct from 'active' then raise exception 'player not active' using errcode = '22023'; end if;
  if k in ('individual', 'goalkeeper') then
    select * into ses from individual_sessions where id = s and goalkeepers = (k = 'goalkeeper');
    if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
    if ses.starts_at < now_local then raise exception 'session in the past' using errcode = '22023'; end if;
    perform ind_book(s, p);
  elsif k = 'extra' then
    select * into ex from extra_sessions where id = s for update;
    if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
    if ex.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
    if ex.starts_on < now_local::date then raise exception 'session in the past' using errcode = '22023'; end if;
    if ex.starts_time is not null and ex.starts_on + ex.starts_time <= now_local then raise exception 'session in the past' using errcode = '22023'; end if;
    if exists (select 1 from extra_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
    if not extra_eligible(s, p) then raise exception 'not eligible' using errcode = '22023'; end if;
    cap := extra_session_cap(s);
    if cap is not null and (select count(*) from extra_bookings where session_id = s) >= cap then raise exception 'session full' using errcode = '22023'; end if;
    insert into extra_bookings (session_id, player_id) values (s, p);
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  perform booking_family_notice((select club_id from players where id = p), null, 'booking_confirm', null, array[p], 'Запись подтверждена: ', ' — ' || booking_session_label(k, s) || '.');
  perform enqueue_to_admins('booking', 'Запись на занятие: ' || nm || '. Откройте приложение: Ещё → Индивидуальные.');
end $$;

revoke execute on function booking_cancel(text, uuid, uuid) from public, anon;
grant execute on function booking_cancel(text, uuid, uuid) to authenticated;

revoke execute on function booking_signup(text, uuid, uuid) from public, anon;
grant execute on function booking_signup(text, uuid, uuid) to authenticated;
