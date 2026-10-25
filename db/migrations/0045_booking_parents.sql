-- Запись родителей на индивидуальные, вратарские и дополнительные тренировки (этап 2 переноса из старого приложения).
-- Родитель видит ближайшие занятия, места и кто записан (имена), записывает и отменяет запись своего ребёнка.
-- Оплату вносит только администратор (ind_set_paid / extra_set_paid), родитель её видит по своим детям.
-- Отмена: пока в любое время; ограничение «за N часов» включается настройкой club_settings 'booking.cancelHours' (по умолчанию 0).
-- Виды занятия: individual, goalkeeper (individual_sessions, 0034), extra (extra_sessions, 0035).

create or replace function booking_is_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians g where g.user_id = current_user_id() and g.consent_revoked_at is null)
$$;

-- Ближайшие занятия (на 60 дней вперёд). booked — имена всех записанных; mine — дети текущего родителя с оплатой.
create or replace function booking_board()
returns table (kind text, session_id uuid, starts_at timestamp, title text, place text, capacity int, amount numeric, booked jsonb, mine jsonb)
language plpgsql stable security definer set search_path = public as $$
declare now_local timestamp := now() at time zone 'Asia/Tbilisi';
begin
  if current_user_id() is null or not (is_admin() or booking_is_parent()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select case when s.goalkeepers then 'goalkeeper' else 'individual' end, s.id, s.starts_at,
    coalesce(s.topic, case when s.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end), null::text,
    ind_cap(s.club_id, s.goalkeepers), ind_price(s.club_id, s.starts_at::date),
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', b.amount) order by pl.full_name)
              from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id and is_guardian_of(b.player_id)), '[]'::jsonb)
  from individual_sessions s where s.starts_at >= now_local and s.starts_at < now_local + interval '60 days'
  union all
  select 'extra', e.id, e.starts_on::timestamp, 'Дополнительная тренировка', e.place, null::int, e.amount,
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', coalesce(b.paid_amount, e.amount)) order by pl.full_name)
              from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id and is_guardian_of(b.player_id)), '[]'::jsonb)
  from extra_sessions e where e.starts_on >= now_local::date and e.starts_on < now_local::date + 60
  order by 3, 1;
end $$;

-- Записать своего ребёнка
create or replace function booking_signup(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ex extra_sessions; now_local timestamp := now() at time zone 'Asia/Tbilisi'; nm text;
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  select full_name into nm from players where id = p;
  if k in ('individual', 'goalkeeper') then
    select * into ses from individual_sessions where id = s and goalkeepers = (k = 'goalkeeper');
    if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
    if ses.starts_at < now_local then raise exception 'session in the past' using errcode = '22023'; end if;
    perform ind_book(s, p);
  elsif k = 'extra' then
    select * into ex from extra_sessions where id = s;
    if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
    if ex.starts_on < now_local::date then raise exception 'session in the past' using errcode = '22023'; end if;
    if exists (select 1 from extra_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
    insert into extra_bookings (session_id, player_id) values (s, p);
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  perform enqueue_to_admins('booking', 'Запись на занятие: ' || nm || '. Откройте приложение: Ещё → Индивидуальные / Дополнительные.');
end $$;

-- Отменить запись своего ребёнка (оплаченную отменяет только администратор)
create or replace function booking_cancel(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st timestamp; was_paid boolean; hrs numeric; now_local timestamp := now() at time zone 'Asia/Tbilisi'; c uuid;
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  if k in ('individual', 'goalkeeper') then
    select ses.starts_at, ses.club_id, b.paid into st, c, was_paid from individual_sessions ses join individual_bookings b on b.session_id = ses.id and b.player_id = p
      where ses.id = s and ses.goalkeepers = (k = 'goalkeeper');
  elsif k = 'extra' then
    select e.starts_on::timestamp, e.club_id, b.paid into st, c, was_paid from extra_sessions e join extra_bookings b on b.session_id = e.id and b.player_id = p where e.id = s;
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  if st is null then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if was_paid then raise exception 'booking is paid' using errcode = '22023'; end if;
  hrs := coalesce(nullif(regexp_replace(coalesce((select value from club_settings where club_id = c and key = 'booking.cancelHours'), ''), '[^0-9.]', '', 'g'), '')::numeric, 0);
  if hrs > 0 and st - now_local < make_interval(secs => (hrs * 3600)::double precision) then raise exception 'too late' using errcode = '22023'; end if;
  if k = 'extra' then delete from extra_bookings where session_id = s and player_id = p;
  else delete from individual_bookings where session_id = s and player_id = p; end if;
end $$;

revoke execute on function booking_is_parent(), booking_board(), booking_signup(text, uuid, uuid), booking_cancel(text, uuid, uuid) from public, anon;
grant execute on function booking_is_parent(), booking_board(), booking_signup(text, uuid, uuid), booking_cancel(text, uuid, uuid) to authenticated;
