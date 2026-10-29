-- Время дополнительной тренировки: начало и окончание (необязательные, задаёт администратор).
-- Если время не указано, поведение прежнее: занятие «начинается» в полночь дня занятия, отмена родителем в день занятия запрещена.
-- Если время указано, родитель не отменяет запись после времени начала. Остальные проверки отмены не меняются.
alter table extra_sessions add column if not exists starts_time time, add column if not exists ends_time time;
alter table extra_sessions add constraint extra_sessions_time_order check (starts_time is null or ends_time is null or ends_time > starts_time);

-- Задать или снять время занятия (оба null — снять). Только администратор.
create or replace function extra_set_time(s uuid, t_start time, t_end time) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from extra_sessions where id = s) then raise exception 'session not found' using errcode = 'P0002'; end if;
  if t_end is not null and t_start is null then raise exception 'start required' using errcode = '22023'; end if;
  if t_start is not null and t_end is not null and t_end <= t_start then raise exception 'end before start' using errcode = '22023'; end if;
  update extra_sessions set starts_time = t_start, ends_time = t_end where id = s;
end $$;
revoke execute on function extra_set_time(uuid, time, time) from public, anon;
grant execute on function extra_set_time(uuid, time, time) to authenticated;

create or replace function booking_cancel(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st timestamp; was_paid boolean; marked boolean; hrs numeric; now_local timestamp := now() at time zone 'Asia/Tbilisi'; c uuid;
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  if k in ('individual', 'goalkeeper') then
    select ses.starts_at, ses.club_id, b.paid, b.attended is not null into st, c, was_paid, marked from individual_sessions ses join individual_bookings b on b.session_id = ses.id and b.player_id = p
      where ses.id = s and ses.goalkeepers = (k = 'goalkeeper');
  elsif k = 'extra' then
    select e.starts_on::timestamp + coalesce(e.starts_time, time '00:00'), e.club_id, b.paid, b.attended is not null into st, c, was_paid, marked from extra_sessions e join extra_bookings b on b.session_id = e.id and b.player_id = p where e.id = s;
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
