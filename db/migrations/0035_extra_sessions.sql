-- Дополнительные тренировки для администратора (перенос из старого приложения: Extra.js).
-- Тренировка: дата, сумма и место; записанные игроки платят отдельно. Только администратор.
-- Правила в функциях: оплаченную запись нельзя убрать, тренировку с оплатами нельзя удалить, перенести или изменить в сумме.
create table extra_sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  starts_on date not null,
  amount numeric(10,2) not null default 0 check (amount >= 0),
  place text,
  unique (club_id, starts_on)
);
create table extra_bookings (
  session_id uuid not null references extra_sessions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  paid boolean not null default false,
  paid_amount numeric(10,2),
  method text,
  attended boolean, -- null — не отмечено, true — был, false — не пришёл
  primary key (session_id, player_id)
);
alter table extra_sessions enable row level security;
alter table extra_bookings enable row level security;
create policy extra_sessions_admin on extra_sessions for all using (is_admin()) with check (is_admin());
create policy extra_bookings_admin on extra_bookings for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on extra_sessions, extra_bookings to authenticated, service_role;

create or replace function extra_create_session(d date, amt numeric, plc text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; sid uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if d is null then raise exception 'date required' using errcode = '22023'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  if exists (select 1 from extra_sessions where club_id = c and starts_on = d) then raise exception 'session exists' using errcode = '23505'; end if;
  insert into extra_sessions (club_id, starts_on, amount, place) values (c, d, amt, nullif(trim(plc), '')) returning id into sid;
  return sid;
end $$;

create or replace function extra_edit_session(s uuid, d date, amt numeric, plc text) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if exists (select 1 from extra_bookings where session_id = s and paid) and (d <> ses.starts_on or amt <> ses.amount) then raise exception 'session has payments' using errcode = '22023'; end if;
  if d <> ses.starts_on and exists (select 1 from extra_sessions where club_id = ses.club_id and starts_on = d) then raise exception 'session exists' using errcode = '23505'; end if;
  update extra_sessions set starts_on = d, amount = amt, place = nullif(trim(plc), '') where id = s;
end $$;

create or replace function extra_delete_session(s uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if exists (select 1 from extra_bookings where session_id = s and paid) then raise exception 'session has payments' using errcode = '22023'; end if;
  delete from extra_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
end $$;

create or replace function extra_add_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid; pc uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into c from extra_sessions where id = s;
  if c is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  select club_id into pc from players where id = p;
  if pc is null or pc <> c then raise exception 'player not in club' using errcode = '22023'; end if;
  if exists (select 1 from extra_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
  insert into extra_bookings (session_id, player_id) values (s, p);
end $$;

create or replace function extra_remove_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if exists (select 1 from extra_bookings where session_id = s and player_id = p and paid) then raise exception 'booking is paid' using errcode = '22023'; end if;
  delete from extra_bookings where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

-- Оплата: по умолчанию сумма тренировки; можно указать другую. Отмена оплаты — is_paid = false.
create or replace function extra_set_paid(s uuid, p uuid, is_paid boolean, mth text default null, amt numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses_amt numeric;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select amount into ses_amt from extra_sessions where id = s;
  if is_paid then
    update extra_bookings set paid = true, paid_amount = coalesce(amt, ses_amt), method = nullif(trim(mth), '') where session_id = s and player_id = p;
  else
    update extra_bookings set paid = false, paid_amount = null, method = null where session_id = s and player_id = p;
  end if;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

create or replace function extra_set_attended(s uuid, p uuid, was boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update extra_bookings set attended = was where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

revoke execute on function extra_create_session(date, numeric, text), extra_edit_session(uuid, date, numeric, text), extra_delete_session(uuid),
  extra_add_player(uuid, uuid), extra_remove_player(uuid, uuid), extra_set_paid(uuid, uuid, boolean, text, numeric), extra_set_attended(uuid, uuid, boolean) from public, anon;
grant execute on function extra_create_session(date, numeric, text), extra_edit_session(uuid, date, numeric, text), extra_delete_session(uuid),
  extra_add_player(uuid, uuid), extra_remove_player(uuid, uuid), extra_set_paid(uuid, uuid, boolean, text, numeric), extra_set_attended(uuid, uuid, boolean) to authenticated;
