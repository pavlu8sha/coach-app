-- Очередь ожидания на индивидуальные, вратарские и дополнительные тренировки (Issue #274, PR 6).
-- Модель: когда места нет, родитель ставит ребёнка в очередь. Как только место освободилось (отмена, удаление записи админом,
-- рост вместимости), уведомление получают ВСЕ родители из очереди одновременно. Место получает первый, кто успешно подтвердил
-- (waitlist_claim блокирует занятие, поэтому подтверждение атомарное). Предложение действует до начала занятия, таймеров нет.
-- Предложение «вычисляется»: оно есть у каждой позиции очереди, пока у занятия есть свободное место и оно не началось.
-- При переносе даты или времени всем в очереди уходит новое сообщение; смена места старые предложения не трогает.
-- Сообщения идут через booking_family_notice, то есть подчиняются настройке booking.notify и общему выключателю родителя.

create table booking_waitlist (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  kind text not null check (kind in ('individual', 'goalkeeper', 'extra')),
  session_id uuid not null,
  player_id uuid not null references players(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  unique (session_id, player_id)
);
create index booking_waitlist_session_idx on booking_waitlist (session_id, created_at);
alter table booking_waitlist enable row level security;
drop policy if exists booking_waitlist_staff_read on booking_waitlist;
create policy booking_waitlist_staff_read on booking_waitlist for select using (is_admin() or is_any_coach());
revoke all on booking_waitlist from public, anon, authenticated;
grant select on booking_waitlist to authenticated;

-- Состояние занятия для очереди: начало, свободные места, отменено ли. Нет строки — занятия нет.
create or replace function waitlist_state(k text, s uuid)
returns table (club_id uuid, starts_at timestamp, free int, cancelled boolean)
language plpgsql stable security definer set search_path = public as $$
declare i individual_sessions; e extra_sessions; cap int;
begin
  if k = 'extra' then
    select * into e from extra_sessions where id = s;
    if not found then return; end if;
    cap := extra_session_cap(s);
    return query select e.club_id, case when e.starts_time is null then (e.starts_on + 1)::timestamp else e.starts_on + e.starts_time end,
      case when cap is null then 1000000 else greatest(0, cap - (select count(*)::int from extra_bookings where session_id = s)) end, e.cancelled_at is not null;
  else
    select * into i from individual_sessions where id = s and goalkeepers = (k = 'goalkeeper');
    if not found then return; end if;
    cap := ind_cap(i.club_id, i.goalkeepers);
    return query select i.club_id, i.starts_at,
      case when cap is null then 1000000 else greatest(0, cap - (select count(*)::int from individual_bookings where session_id = s)) end, false;
  end if;
end $$;

-- Всем в очереди: освободилось место (moved = false) или занятие перенесено (moved = true)
create or replace function waitlist_notify(k text, s uuid, moved boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare st record; pls uuid[]; lbl text;
begin
  select * into st from waitlist_state(k, s);
  if st.club_id is null or st.cancelled or st.starts_at <= now() at time zone 'Asia/Tbilisi' then return; end if;
  pls := array(select player_id from booking_waitlist where session_id = s order by created_at);
  if coalesce(cardinality(pls), 0) = 0 then return; end if;
  lbl := booking_session_label(k, s);
  if st.free > 0 then
    perform booking_family_notice(st.club_id, null, 'waitlist_offer', null, pls,
      case when moved then 'Занятие перенесено, есть свободное место: ' else 'Освободилось место: ' end,
      ' — ' || lbl || '. Подтвердите в приложении (Запись на занятия): место получит тот, кто подтвердит первым. Предложение действует до начала занятия.');
  elsif moved then
    perform booking_family_notice(st.club_id, null, 'waitlist_moved', null, pls, 'Занятие перенесено: ', ' — ' || lbl || '. Вы остаётесь в очереди.');
  end if;
end $$;

-- Триггеры: освобождение места, запись (убирает из очереди), перенос, отмена и удаление занятия
create or replace function waitlist_trg_freed() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if tg_table_name = 'extra_bookings' then k := 'extra';
  else select case when goalkeepers then 'goalkeeper' else 'individual' end into k from individual_sessions where id = old.session_id; end if;
  if k is not null then perform waitlist_notify(k, old.session_id); end if;
  return null;
end $$;
create or replace function waitlist_trg_booked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from booking_waitlist where session_id = new.session_id and player_id = new.player_id;
  return null;
end $$;
create or replace function waitlist_trg_ind_session() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then delete from booking_waitlist where session_id = old.id; return null; end if;
  if new.starts_at is distinct from old.starts_at then
    perform waitlist_notify(case when new.goalkeepers then 'goalkeeper' else 'individual' end, new.id, true);
  end if;
  return null;
end $$;
create or replace function waitlist_trg_extra_session() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then delete from booking_waitlist where session_id = old.id; return null; end if;
  if new.cancelled_at is not null and old.cancelled_at is null then
    delete from booking_waitlist where session_id = new.id;
  elsif (new.starts_on, new.starts_time) is distinct from (old.starts_on, old.starts_time) then
    perform waitlist_notify('extra', new.id, true);
  elsif new.capacity is distinct from old.capacity then
    perform waitlist_notify('extra', new.id);
  end if;
  return null;
end $$;
drop trigger if exists waitlist_freed on individual_bookings;
create trigger waitlist_freed after delete on individual_bookings for each row execute function waitlist_trg_freed();
drop trigger if exists waitlist_freed on extra_bookings;
create trigger waitlist_freed after delete on extra_bookings for each row execute function waitlist_trg_freed();
drop trigger if exists waitlist_booked on individual_bookings;
create trigger waitlist_booked after insert on individual_bookings for each row execute function waitlist_trg_booked();
drop trigger if exists waitlist_booked on extra_bookings;
create trigger waitlist_booked after insert on extra_bookings for each row execute function waitlist_trg_booked();
drop trigger if exists waitlist_ind_session on individual_sessions;
create trigger waitlist_ind_session after update of starts_at or delete on individual_sessions for each row execute function waitlist_trg_ind_session();
drop trigger if exists waitlist_extra_session on extra_sessions;
create trigger waitlist_extra_session after update of starts_on, starts_time, capacity, cancelled_at or delete on extra_sessions for each row execute function waitlist_trg_extra_session();

-- Родитель: встать в очередь (только когда мест нет)
create or replace function waitlist_join(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st record; stt text; booked boolean;
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  if k not in ('individual', 'goalkeeper', 'extra') then raise exception 'bad kind' using errcode = '22023'; end if;
  select status into stt from players where id = p;
  if stt is distinct from 'active' then raise exception 'player not active' using errcode = '22023'; end if;
  if k = 'extra' then perform 1 from extra_sessions where id = s for update; else perform 1 from individual_sessions where id = s for update; end if;
  select * into st from waitlist_state(k, s);
  if st.club_id is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if st.cancelled then raise exception 'session cancelled' using errcode = '55000'; end if;
  if st.starts_at <= now() at time zone 'Asia/Tbilisi' then raise exception 'session in the past' using errcode = '22023'; end if;
  booked := case when k = 'extra' then exists (select 1 from extra_bookings where session_id = s and player_id = p)
                 else exists (select 1 from individual_bookings where session_id = s and player_id = p) end;
  if booked then raise exception 'already booked' using errcode = '23505'; end if;
  if k = 'extra' and not extra_eligible(s, p) then raise exception 'not eligible' using errcode = '22023'; end if;
  if st.free > 0 then raise exception 'seat available' using errcode = '22023'; end if;
  insert into booking_waitlist (club_id, kind, session_id, player_id, user_id) values (st.club_id, k, s, p, current_user_id()) on conflict do nothing;
end $$;

create or replace function waitlist_leave(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from booking_waitlist where session_id = s and player_id = p;
end $$;

-- Родитель: подтвердить место. Занятие блокируется внутри booking_signup, поэтому из нескольких подтверждений место получает первое.
create or replace function waitlist_claim(k text, s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from booking_waitlist where session_id = s and player_id = p) then raise exception 'not in waitlist' using errcode = 'P0002'; end if;
  perform booking_signup(k, s, p);
  delete from booking_waitlist where session_id = s and player_id = p;
end $$;

-- Родитель: позиции его детей в очередях. offer = есть свободное место, можно подтверждать.
create or replace function waitlist_board()
returns table (kind text, session_id uuid, player_id uuid, pos int, total int, offer boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select w.kind, w.session_id, w.player_id,
         (select count(*)::int from booking_waitlist x where x.session_id = w.session_id and (x.created_at, x.id) <= (w.created_at, w.id)),
         (select count(*)::int from booking_waitlist x where x.session_id = w.session_id),
         (select st.free > 0 and not st.cancelled and st.starts_at > now() at time zone 'Asia/Tbilisi' from waitlist_state(w.kind, w.session_id) st)
    from booking_waitlist w where is_guardian_of(w.player_id);
end $$;

-- Администратор и тренер (только чтение): очередь занятия по порядку
create or replace function waitlist_session(s uuid)
returns table (pos int, player_id uuid, name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select (row_number() over (order by w.created_at, w.id))::int, w.player_id, pl.full_name, w.created_at
    from booking_waitlist w join players pl on pl.id = w.player_id where w.session_id = s order by 1;
end $$;

revoke execute on function waitlist_state(text, uuid), waitlist_notify(text, uuid, boolean), waitlist_trg_freed(), waitlist_trg_booked(),
  waitlist_trg_ind_session(), waitlist_trg_extra_session() from public, anon, authenticated;
revoke execute on function waitlist_join(text, uuid, uuid), waitlist_leave(text, uuid, uuid), waitlist_claim(text, uuid, uuid),
  waitlist_board(), waitlist_session(uuid) from public, anon;
grant execute on function waitlist_join(text, uuid, uuid), waitlist_leave(text, uuid, uuid), waitlist_claim(text, uuid, uuid),
  waitlist_board(), waitlist_session(uuid) to authenticated;
