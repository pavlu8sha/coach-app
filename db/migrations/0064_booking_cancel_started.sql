-- S-04: родитель отменяет запись только на будущее занятие, не оплаченную и без отметки посещаемости.
-- Начавшееся занятие (для дополнительной тренировки — день занятия, так как время там не хранится) и запись с отметкой
-- (был или не пришёл) родитель отменить не может: отметка и долг не должны удаляться вместе с записью. Администратор
-- работает через свои пути и этим не ограничен. Остальные проверки (оплата, cancelHours) не меняются.
create or replace function booking_cancel(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st timestamp; was_paid boolean; marked boolean; hrs numeric; now_local timestamp := now() at time zone 'Asia/Tbilisi'; c uuid;
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  if k in ('individual', 'goalkeeper') then
    select ses.starts_at, ses.club_id, b.paid, b.attended is not null into st, c, was_paid, marked from individual_sessions ses join individual_bookings b on b.session_id = ses.id and b.player_id = p
      where ses.id = s and ses.goalkeepers = (k = 'goalkeeper');
  elsif k = 'extra' then
    select e.starts_on::timestamp, e.club_id, b.paid, b.attended is not null into st, c, was_paid, marked from extra_sessions e join extra_bookings b on b.session_id = e.id and b.player_id = p where e.id = s;
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  if st is null then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if was_paid then raise exception 'booking is paid' using errcode = '22023'; end if;
  if marked then raise exception 'attendance marked' using errcode = '22023'; end if;
  if st <= now_local then raise exception 'session already started' using errcode = '22023'; end if;
  hrs := coalesce(nullif(regexp_replace(coalesce((select value from club_settings where club_id = c and key = 'booking.cancelHours'), ''), '[^0-9.]', '', 'g'), '')::numeric, 0);
  if hrs > 0 and st - now_local < make_interval(secs => (hrs * 3600)::double precision) then raise exception 'too late' using errcode = '22023'; end if;
  if k = 'extra' then delete from extra_bookings where session_id = s and player_id = p;
  else delete from individual_bookings where session_id = s and player_id = p; end if;
end $$;
