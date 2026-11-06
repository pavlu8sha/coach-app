-- Целевые группы и персональные приглашения на дополнительные тренировки (Issue #274, PR 4).
-- Допуск к записи: ребёнок из целевой группы или приглашён администратором. Занятия, созданные до этой миграции
-- (targeted = false), остаются открытыми для всех, как раньше. Новое занятие с группами или игроками получает targeted = true.
-- Удаление группы или игрока из целей записи не удаляет: функции возвращают, сколько записанных потеряли допуск, и только предупреждают.
-- Смена группы ребёнка: запись сохраняется, новая возможна только при соответствии; админ и тренер видят «не из целевой группы» (extra_ineligible).

alter table extra_sessions add column if not exists targeted boolean not null default false;

alter table extra_activity drop constraint if exists extra_activity_action_check;
alter table extra_activity add constraint extra_activity_action_check
  check (action in ('created', 'edited', 'time_set', 'capacity_set', 'cancelled', 'target_group_added', 'target_group_removed', 'target_player_added', 'target_player_removed'));

create table extra_session_groups (
  session_id uuid not null references extra_sessions(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  added_by uuid references users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (session_id, group_id)
);
create table extra_session_players (
  session_id uuid not null references extra_sessions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  added_by uuid references users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (session_id, player_id)
);
alter table extra_session_groups enable row level security;
alter table extra_session_players enable row level security;
revoke all on extra_session_groups, extra_session_players from public, anon, authenticated;
grant select on extra_session_groups, extra_session_players to authenticated;
create policy extra_session_groups_read on extra_session_groups for select using (is_admin() or is_any_coach());
create policy extra_session_players_read on extra_session_players for select using (is_admin() or is_any_coach());
grant all on extra_session_groups, extra_session_players to service_role;

-- Допущен ли ребёнок к записи на занятие (служебная)
create or replace function extra_eligible(s uuid, p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (not e.targeted)
        or exists (select 1 from extra_session_players sp where sp.session_id = e.id and sp.player_id = p)
        or exists (select 1 from extra_session_groups sg join players pl on pl.group_id = sg.group_id where sg.session_id = e.id and pl.id = p)
      from extra_sessions e where e.id = s
  ), false)
$$;
revoke execute on function extra_eligible(uuid, uuid) from public, anon, authenticated;

-- Родители, которым адресовано занятие: опекуны детей целевых групп и приглашённых (без отозванного согласия). Для уведомлений (PR 5).
create or replace function extra_recipients(s uuid) returns table (user_id uuid, player_id uuid)
language sql stable security definer set search_path = public as $$
  select g.user_id, g.player_id
    from player_guardians g join players pl on pl.id = g.player_id
    join extra_sessions e on e.id = s and e.targeted
   where g.consent_revoked_at is null and pl.status = 'active' and extra_eligible(s, g.player_id)
$$;
revoke execute on function extra_recipients(uuid) from public, anon, authenticated;

-- Создание: целевые группы и приглашённые необязательны на уровне базы; экран требует хотя бы одну цель
drop function if exists extra_create_session(date, numeric, text);
create or replace function extra_create_session(d date, amt numeric, plc text, grps uuid[] default null, pls uuid[] default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; sid uuid; g uuid; pl uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if d is null then raise exception 'date required' using errcode = '22023'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  insert into extra_sessions (club_id, starts_on, amount, place, targeted)
    values (c, d, amt, nullif(trim(plc), ''), coalesce(cardinality(grps), 0) + coalesce(cardinality(pls), 0) > 0) returning id into sid;
  foreach g in array coalesce(grps, '{}') loop
    if not exists (select 1 from groups where id = g and club_id = c) then raise exception 'group not found' using errcode = 'P0002'; end if;
    insert into extra_session_groups (session_id, group_id, added_by) values (sid, g, current_user_id()) on conflict do nothing;
  end loop;
  foreach pl in array coalesce(pls, '{}') loop
    if not exists (select 1 from players where id = pl and club_id = c) then raise exception 'player not in club' using errcode = '22023'; end if;
    insert into extra_session_players (session_id, player_id, added_by) values (sid, pl, current_user_id()) on conflict do nothing;
  end loop;
  perform extra_log(sid, 'created', jsonb_build_object('starts_on', d, 'amount', amt, 'place', nullif(trim(plc), ''), 'groups', coalesce(grps, '{}'), 'players', coalesce(pls, '{}')));
  return sid;
end $$;
revoke execute on function extra_create_session(date, numeric, text, uuid[], uuid[]) from public, anon;
grant execute on function extra_create_session(date, numeric, text, uuid[], uuid[]) to authenticated;

-- Группа в целях занятия (после публикации можно добавлять и убирать). Возвращает, сколько записанных детей группы
-- после удаления потеряли допуск (записи не удаляются, только предупреждение).
create or replace function extra_target_group(s uuid, g uuid, on_ boolean) returns int
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; n int := 0;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  if not exists (select 1 from groups where id = g and club_id = ses.club_id) then raise exception 'group not found' using errcode = 'P0002'; end if;
  if coalesce(on_, false) then
    insert into extra_session_groups (session_id, group_id, added_by) values (s, g, current_user_id()) on conflict do nothing;
    update extra_sessions set targeted = true where id = s;
    perform extra_log(s, 'target_group_added', jsonb_build_object('group_id', g));
  else
    delete from extra_session_groups where session_id = s and group_id = g;
    select count(*)::int into n from extra_bookings b where b.session_id = s and not extra_eligible(s, b.player_id)
       and exists (select 1 from players pl where pl.id = b.player_id and pl.group_id = g);
    perform extra_log(s, 'target_group_removed', jsonb_build_object('group_id', g, 'bookings_without_access', n));
  end if;
  return n;
end $$;
revoke execute on function extra_target_group(uuid, uuid, boolean) from public, anon;
grant execute on function extra_target_group(uuid, uuid, boolean) to authenticated;

create or replace function extra_target_player(s uuid, p uuid, on_ boolean) returns int
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; n int := 0;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  if not exists (select 1 from players where id = p and club_id = ses.club_id) then raise exception 'player not in club' using errcode = '22023'; end if;
  if coalesce(on_, false) then
    insert into extra_session_players (session_id, player_id, added_by) values (s, p, current_user_id()) on conflict do nothing;
    update extra_sessions set targeted = true where id = s;
    perform extra_log(s, 'target_player_added', jsonb_build_object('player_id', p));
  else
    delete from extra_session_players where session_id = s and player_id = p;
    select count(*)::int into n from extra_bookings b where b.session_id = s and b.player_id = p and not extra_eligible(s, p);
    perform extra_log(s, 'target_player_removed', jsonb_build_object('player_id', p, 'bookings_without_access', n));
  end if;
  return n;
end $$;
revoke execute on function extra_target_player(uuid, uuid, boolean) from public, anon;
grant execute on function extra_target_player(uuid, uuid, boolean) to authenticated;

-- Записанные, у которых сейчас нет допуска (сменили группу или цель убрали): запись сохраняется, админ и тренер это видят
create or replace function extra_ineligible(s uuid) returns table (player_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select b.player_id from extra_bookings b where b.session_id = s and not extra_eligible(s, b.player_id);
end $$;
revoke execute on function extra_ineligible(uuid) from public, anon;
grant execute on function extra_ineligible(uuid) to authenticated;

-- Запись родителем: проверка допуска
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
  perform enqueue_to_admins('booking', 'Запись на занятие: ' || nm || '. Откройте приложение: Ещё → Индивидуальные / Дополнительные.');
end $$;

-- Доска записи: у дополнительной колонка eligible (дети родителя, которых можно записать; null — без ограничения)
drop function if exists booking_board();
create function booking_board()
returns table (kind text, session_id uuid, starts_at timestamp, ends_at timestamp, title text, place text, capacity int, amount numeric, booked jsonb, mine jsonb, eligible jsonb)
language plpgsql stable security definer set search_path = public as $$
declare now_local timestamp := now() at time zone 'Asia/Tbilisi';
begin
  if current_user_id() is null or not (is_admin() or booking_is_parent()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select case when s.goalkeepers then 'goalkeeper' else 'individual' end, s.id, s.starts_at, null::timestamp,
    coalesce(s.topic, case when s.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end), null::text,
    ind_cap(s.club_id, s.goalkeepers), ind_price(s.club_id, s.starts_at::date),
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', b.amount) order by pl.full_name)
              from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id and is_guardian_of(b.player_id)), '[]'::jsonb),
    null::jsonb
  from individual_sessions s where s.starts_at >= now_local and s.starts_at < now_local + interval '60 days'
  union all
  select 'extra', e.id, e.starts_on::timestamp + coalesce(e.starts_time, time '00:00'),
    case when e.ends_time is not null then e.starts_on::timestamp + e.ends_time end, 'Дополнительная тренировка', e.place, extra_session_cap(e.id), e.amount,
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', coalesce(b.paid_amount, e.amount)) order by pl.full_name)
              from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id and is_guardian_of(b.player_id)), '[]'::jsonb),
    case when not e.targeted then null::jsonb
         else coalesce((select jsonb_agg(g.player_id) from player_guardians g where g.user_id = current_user_id() and g.consent_revoked_at is null and extra_eligible(e.id, g.player_id)), '[]'::jsonb) end
  from extra_sessions e where e.cancelled_at is null and e.starts_on >= now_local::date and e.starts_on < now_local::date + 60
    and (is_admin() or not e.targeted
         or exists (select 1 from extra_bookings b where b.session_id = e.id and is_guardian_of(b.player_id))
         or exists (select 1 from player_guardians g where g.user_id = current_user_id() and g.consent_revoked_at is null and extra_eligible(e.id, g.player_id)))
  order by 3, 1;
end $$;
revoke execute on function booking_board() from public, anon;
grant execute on function booking_board() to authenticated;
