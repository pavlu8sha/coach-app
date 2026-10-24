-- Индивидуальные и вратарские занятия для администратора (перенос из старого приложения: Individual.js).
-- Таблицы individual_sessions / individual_bookings — миграция 0008 (только администратор). Здесь: тип занятия
-- (вратари), постоянные участники и функции записи, которые держат правила в базе:
--   • оплаченную запись нельзя убрать, занятие с оплатами нельзя удалить или перенести;
--   • мест на занятии не больше настройки ind.capIndividual / ind.capGoalkeepers (если задана);
--   • сумма записи — цена kind = 'individual' на дату занятия (по умолчанию 50 ₾).
alter table individual_sessions add column if not exists goalkeepers boolean not null default false;
-- Отметка посещения записанного (null — не отмечено, true — был, false — не пришёл)
alter table individual_bookings add column if not exists attended boolean;

create table if not exists individual_regulars (
  club_id uuid not null references clubs(id),
  player_id uuid not null references players(id) on delete cascade,
  goalkeepers boolean not null default false,
  primary key (club_id, player_id, goalkeepers)
);
alter table individual_regulars enable row level security;
create policy individual_regulars_admin on individual_regulars for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on individual_regulars to authenticated, service_role;

create or replace function ind_price(c uuid, d date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select amount from prices where club_id = c and kind = 'individual' and group_id is null
                      and valid_from <= date_trunc('month', d)::date and (valid_to is null or valid_to >= date_trunc('month', d)::date)
                    order by valid_from desc limit 1), 50)
$$;

create or replace function ind_cap(c uuid, gk boolean) returns int
language sql stable security definer set search_path = public as $$
  select nullif(regexp_replace(coalesce((select value from club_settings where club_id = c and key = case when gk then 'ind.capGoalkeepers' else 'ind.capIndividual' end), ''), '[^0-9]', '', 'g'), '')::int
$$;

create or replace function ind_assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

-- Записать игрока на занятие (внутренняя; проверки места и клуба здесь)
create or replace function ind_book(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; cap int; n int; pc uuid;
begin
  select * into ses from individual_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  select club_id into pc from players where id = p;
  if pc is null or pc <> ses.club_id then raise exception 'player not in club' using errcode = '22023'; end if;
  if exists (select 1 from individual_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
  cap := ind_cap(ses.club_id, ses.goalkeepers);
  select count(*) into n from individual_bookings where session_id = s;
  if cap is not null and n >= cap then raise exception 'session full' using errcode = '22023'; end if;
  insert into individual_bookings (session_id, player_id, amount, paid) values (s, p, ind_price(ses.club_id, ses.starts_at::date), false);
end $$;

create or replace function ind_create_session(d date, t time, gk boolean, theme text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; sid uuid; ext text; r record;
begin
  perform ind_assert_admin();
  if d is null or t is null then raise exception 'date required' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  ext := 'IND-' || to_char(d, 'YYYY-MM-DD') || '-' || to_char(t, 'HH24MI') || case when gk then '-GK' else '' end;
  if exists (select 1 from individual_sessions where club_id = c and external_id = ext) then raise exception 'session exists' using errcode = '23505'; end if;
  insert into individual_sessions (club_id, external_id, starts_at, topic, goalkeepers)
  values (c, ext, (d + t), nullif(trim(theme), ''), coalesce(gk, false)) returning id into sid;
  for r in select r2.player_id from individual_regulars r2 join players pl on pl.id = r2.player_id
            where r2.club_id = c and r2.goalkeepers = coalesce(gk, false) and pl.status = 'active' loop
    begin perform ind_book(sid, r.player_id); exception when others then null; end; -- переполнение мест не отменяет занятие
  end loop;
  return sid;
end $$;

create or replace function ind_add_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform ind_assert_admin(); perform ind_book(s, p); end $$;

create or replace function ind_set_paid(s uuid, p uuid, is_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ind_assert_admin();
  update individual_bookings set paid = coalesce(is_paid, false) where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

create or replace function ind_remove_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ind_assert_admin();
  if exists (select 1 from individual_bookings where session_id = s and player_id = p and paid) then raise exception 'booking is paid' using errcode = '22023'; end if;
  delete from individual_bookings where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

create or replace function ind_edit_session(s uuid, d date, t time, theme text) returns void
language plpgsql security definer set search_path = public as $$
declare ses individual_sessions; ext text;
begin
  perform ind_assert_admin();
  select * into ses from individual_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if exists (select 1 from individual_bookings where session_id = s and paid) and (d + t) <> ses.starts_at then raise exception 'session has payments' using errcode = '22023'; end if;
  ext := 'IND-' || to_char(d, 'YYYY-MM-DD') || '-' || to_char(t, 'HH24MI') || case when ses.goalkeepers then '-GK' else '' end;
  if ext <> ses.external_id and exists (select 1 from individual_sessions where club_id = ses.club_id and external_id = ext) then raise exception 'session exists' using errcode = '23505'; end if;
  update individual_sessions set starts_at = (d + t), external_id = ext, topic = nullif(trim(theme), '') where id = s;
end $$;

create or replace function ind_delete_session(s uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ind_assert_admin();
  if exists (select 1 from individual_bookings where session_id = s and paid) then raise exception 'session has payments' using errcode = '22023'; end if;
  delete from individual_sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
end $$;

-- Отметка посещения (раздел «Отметки» старого приложения для индивидуальных и вратарей)
create or replace function ind_set_attended(s uuid, p uuid, was boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ind_assert_admin();
  update individual_bookings set attended = was where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

-- Постоянные участники: при создании занятия записываются автоматически; кнопка «Записать постоянных» — для уже созданных
create or replace function ind_set_regular(p uuid, gk boolean, on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform ind_assert_admin();
  select club_id into c from players where id = p;
  if c is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  if on_ then insert into individual_regulars (club_id, player_id, goalkeepers) values (c, p, coalesce(gk, false)) on conflict do nothing;
  else delete from individual_regulars where club_id = c and player_id = p and goalkeepers = coalesce(gk, false); end if;
end $$;

revoke execute on function ind_price(uuid, date), ind_cap(uuid, boolean), ind_assert_admin(), ind_book(uuid, uuid) from public, anon, authenticated;
revoke execute on function ind_create_session(date, time, boolean, text), ind_add_player(uuid, uuid), ind_set_paid(uuid, uuid, boolean),
  ind_remove_player(uuid, uuid), ind_edit_session(uuid, date, time, text), ind_delete_session(uuid), ind_set_regular(uuid, boolean, boolean), ind_set_attended(uuid, uuid, boolean) from public, anon;
grant execute on function ind_create_session(date, time, boolean, text), ind_add_player(uuid, uuid), ind_set_paid(uuid, uuid, boolean),
  ind_remove_player(uuid, uuid), ind_edit_session(uuid, date, time, text), ind_delete_session(uuid), ind_set_regular(uuid, boolean, boolean), ind_set_attended(uuid, uuid, boolean) to authenticated;
