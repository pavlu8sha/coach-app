-- #274, сценарий B (PR 3): модель дополнительных тренировок.
--  * несколько тренировок в один день (снято ограничение «одна на клуб в день»);
--  * вместимость на каждое занятие (extra_sessions.capacity); пусто — клубное значение extra.cap; extra_set_capacity предупреждает,
--    если записанных больше нового лимита, и ничего не удаляет;
--  * перенос даты, времени и места разрешён и при оплатах: записи и оплаты привязаны к занятию и сохраняются; сумма при оплатах по-прежнему не меняется;
--  * отмена занятия клубом (extra_cancel_session): статус, автор, причина; записи и оплаты сохраняются. Отменённая тренировка исчезает
--    из доски записи и календаря родителя, из долгов, списка тренера и баллов (начисление снимается), запись и отметки на ней закрыты;
--  * журнал действий extra_activity (создание, правка, время, вместимость, отмена) для администратора.
-- Уведомления родителям об изменениях и отмене появятся в отдельном PR (сообщения о записи); здесь только модель.

alter table extra_sessions drop constraint if exists extra_sessions_club_id_starts_on_key;
alter table extra_sessions add column if not exists capacity int check (capacity is null or (capacity >= 1 and capacity <= 100));
alter table extra_sessions add column if not exists cancelled_at timestamptz;
alter table extra_sessions add column if not exists cancelled_by uuid references users(id) on delete set null;
alter table extra_sessions add column if not exists cancel_reason text;

create table if not exists extra_activity (
  id bigint generated always as identity primary key,
  session_id uuid not null references extra_sessions(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action text not null check (action in ('created', 'edited', 'time_set', 'capacity_set', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists extra_activity_session on extra_activity (session_id, id);
alter table extra_activity enable row level security;
revoke all on extra_activity from public, anon, authenticated;
grant select on extra_activity to authenticated;
grant all on extra_activity to service_role;
create policy extra_activity_admin on extra_activity for select using (is_admin());

create or replace function extra_log(s uuid, act text, pl jsonb) returns void
language sql security definer set search_path = public as $$
  insert into extra_activity (session_id, actor_id, action, payload) values (s, current_user_id(), act, coalesce(pl, '{}'::jsonb))
$$;
revoke execute on function extra_log(uuid, text, jsonb) from public, anon, authenticated;

-- Вместимость занятия: своя или клубная по умолчанию (null — без ограничения)
create or replace function extra_session_cap(s uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(e.capacity, extra_cap(e.club_id)) from extra_sessions e where e.id = s
$$;
revoke execute on function extra_session_cap(uuid) from public, anon, authenticated;

-- Задать вместимость занятия (null — вернуть клубное значение). Возвращает, на сколько записанных больше нового лимита (0 — всё в порядке).
create or replace function extra_set_capacity(s uuid, cap int) returns int
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions; n int; eff int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  if cap is not null and (cap < 1 or cap > 100) then raise exception 'bad capacity' using errcode = '22023'; end if;
  update extra_sessions set capacity = cap where id = s;
  perform extra_log(s, 'capacity_set', jsonb_build_object('before', ses.capacity, 'after', cap));
  eff := coalesce(cap, extra_cap(ses.club_id));
  select count(*)::int into n from extra_bookings where session_id = s;
  return case when eff is not null and n > eff then n - eff else 0 end;
end $$;
revoke execute on function extra_set_capacity(uuid, int) from public, anon;
grant execute on function extra_set_capacity(uuid, int) to authenticated;

-- Отмена занятия клубом: записи и оплаты остаются, запись и отметки закрываются
create or replace function extra_cancel_session(s uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  update extra_sessions set cancelled_at = clock_timestamp(), cancelled_by = current_user_id(), cancel_reason = nullif(trim(p_reason), '') where id = s;
  perform extra_log(s, 'cancelled', jsonb_build_object('reason', nullif(trim(p_reason), ''), 'bookings', (select count(*) from extra_bookings where session_id = s)));
end $$;
revoke execute on function extra_cancel_session(uuid, text) from public, anon;
grant execute on function extra_cancel_session(uuid, text) to authenticated;

create or replace function extra_create_session(d date, amt numeric, plc text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; sid uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if d is null then raise exception 'date required' using errcode = '22023'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id into c from clubs order by id limit 1;
  insert into extra_sessions (club_id, starts_on, amount, place) values (c, d, amt, nullif(trim(plc), '')) returning id into sid;
  perform extra_log(sid, 'created', jsonb_build_object('starts_on', d, 'amount', amt, 'place', nullif(trim(plc), '')));
  return sid;
end $$;

-- Правка: дату и место можно менять и при оплатах (записи и оплаты сохраняются), сумму при оплатах менять нельзя
create or replace function extra_edit_session(s uuid, d date, amt numeric, plc text) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if d is null then raise exception 'date required' using errcode = '22023'; end if;
  if amt <> ses.amount and exists (select 1 from extra_bookings where session_id = s and paid) then raise exception 'session has payments' using errcode = '22023'; end if;
  update extra_sessions set starts_on = d, amount = amt, place = nullif(trim(plc), '') where id = s;
  if d <> ses.starts_on or amt <> ses.amount or nullif(trim(plc), '') is distinct from ses.place then
    perform extra_log(s, 'edited', jsonb_build_object('before', jsonb_build_object('starts_on', ses.starts_on, 'amount', ses.amount, 'place', ses.place),
                                                      'after', jsonb_build_object('starts_on', d, 'amount', amt, 'place', nullif(trim(plc), ''))));
  end if;
end $$;

create or replace function extra_set_time(s uuid, t_start time, t_end time) returns void
language plpgsql security definer set search_path = public as $$
declare ses extra_sessions;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from extra_sessions where id = s for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if ses.cancelled_at is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  if t_end is not null and t_start is null then raise exception 'start required' using errcode = '22023'; end if;
  if t_start is not null and t_end is not null and t_end <= t_start then raise exception 'end before start' using errcode = '22023'; end if;
  update extra_sessions set starts_time = t_start, ends_time = t_end where id = s;
  if t_start is distinct from ses.starts_time or t_end is distinct from ses.ends_time then
    perform extra_log(s, 'time_set', jsonb_build_object('before', jsonb_build_object('starts_time', ses.starts_time, 'ends_time', ses.ends_time),
                                                       'after', jsonb_build_object('starts_time', t_start, 'ends_time', t_end)));
  end if;
end $$;


create or replace function extra_add_player(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid; pc uuid; cap int; canc timestamptz;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id, cancelled_at into c, canc from extra_sessions where id = s for update;
  if c is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if canc is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  select club_id into pc from players where id = p;
  if pc is null or pc <> c then raise exception 'player not in club' using errcode = '22023'; end if;
  if exists (select 1 from extra_bookings where session_id = s and player_id = p) then raise exception 'already booked' using errcode = '23505'; end if;
  cap := extra_session_cap(s);
  if cap is not null and (select count(*) from extra_bookings where session_id = s) >= cap then raise exception 'session full' using errcode = '22023'; end if;
  insert into extra_bookings (session_id, player_id) values (s, p);
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
    cap := extra_session_cap(s);
    if cap is not null and (select count(*) from extra_bookings where session_id = s) >= cap then raise exception 'session full' using errcode = '22023'; end if;
    insert into extra_bookings (session_id, player_id) values (s, p);
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
  perform enqueue_to_admins('booking', 'Запись на занятие: ' || nm || '. Откройте приложение: Ещё → Индивидуальные / Дополнительные.');
end $$;

drop function if exists booking_board();
create function booking_board()
returns table (kind text, session_id uuid, starts_at timestamp, ends_at timestamp, title text, place text, capacity int, amount numeric, booked jsonb, mine jsonb)
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
              from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id and is_guardian_of(b.player_id)), '[]'::jsonb)
  from individual_sessions s where s.starts_at >= now_local and s.starts_at < now_local + interval '60 days'
  union all
  select 'extra', e.id, e.starts_on::timestamp + coalesce(e.starts_time, time '00:00'),
    case when e.ends_time is not null then e.starts_on::timestamp + e.ends_time end, 'Дополнительная тренировка', e.place, extra_session_cap(e.id), e.amount,
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', coalesce(b.paid_amount, e.amount)) order by pl.full_name)
              from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id and is_guardian_of(b.player_id)), '[]'::jsonb)
  from extra_sessions e where e.cancelled_at is null and e.starts_on >= now_local::date and e.starts_on < now_local::date + 60
  order by 3, 1;
end $$;

revoke execute on function booking_board() from public, anon;
grant execute on function booking_board() to authenticated;
create or replace function extra_roster_list(d_from date, d_to date)
returns table (session_id uuid, starts_on date, place text, player_id uuid, full_name text, attended boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if d_from is null or d_to is null or d_to < d_from then raise exception 'bad period' using errcode = '22023'; end if;
  if d_to - d_from > 120 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  select s.id, s.starts_on, s.place, b.player_id, p.full_name, b.attended
  from extra_sessions s
  left join extra_bookings b on b.session_id = s.id
  left join players p on p.id = b.player_id
  where s.starts_on between d_from and d_to and s.cancelled_at is null
  order by s.starts_on desc, p.full_name;
end $$;

create or replace function extra_set_attended(s uuid, p uuid, was boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d date; canc timestamptz;
begin
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select starts_on, cancelled_at into d, canc from extra_sessions where id = s;
  if d is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if canc is not null then raise exception 'session cancelled' using errcode = '55000'; end if;
  if not is_admin() and d > (now() at time zone 'Asia/Tbilisi')::date then raise exception 'date in the future' using errcode = '22023'; end if;
  update extra_bookings set attended = was where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

create or replace function points_reconcile_extra(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s extra_sessions; club uuid; day date; rv points_rule_versions; pts int; exp jsonb := '[]'::jsonb;
begin
  select * into s from extra_sessions where id = sid;
  if s.id is null then
    select l.club_id into club from points_ledger l where l.source_type = 'extra' and l.source_id = sid limit 1;
    if club is not null then perform points_ledger_apply(club, 'extra', sid, '[]'::jsonb, 'source_deleted'); end if;
    return;
  end if;
  club := s.club_id;
  day := s.starts_on;
  if s.cancelled_at is not null then
    perform points_ledger_apply(club, 'extra', sid, '[]'::jsonb, 'session_cancelled');
    return;
  end if;
  rv := points_rules_for(club, day);
  if rv.id is not null and coalesce((rv.params #>> '{enabled,training}')::boolean, false) then
    pts := (rv.params #>> '{training,extra}')::int;
    if pts > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('player_id', b.player_id, 'group_id', points_group_at(b.player_id, day), 'event_date', day,
               'reason_code', 'attended', 'points', pts, 'components', jsonb_build_object('kind', 'extra', 'base', pts), 'rule_version_id', rv.id)), '[]'::jsonb)
        into exp from extra_bookings b where b.session_id = sid and b.attended is true;
    end if;
  end if;
  perform points_ledger_apply(club, 'extra', sid, exp, 'attendance_changed');
end $$;

drop trigger if exists points_extra_sessions_sync on extra_sessions;
create trigger points_extra_sessions_sync after update of starts_on, cancelled_at on extra_sessions
  for each row execute function points_trg_extra_row();


create or replace function parent_dues()
returns table (player_id uuid, kind text, title text, on_date date, due numeric, paid numeric, debt numeric)
language plpgsql stable security definer set search_path = public as $$
declare local_now timestamp := now() at time zone 'Asia/Tbilisi'; today date := (now() at time zone 'Asia/Tbilisi')::date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
  with kids as (
    select pl.id pid
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.user_id = current_user_id() and pg.consent_revoked_at is null
    where pl.status = 'active'
      and exists (select 1 from club_settings cs where cs.club_id = pl.club_id and cs.key = 'parent_debt_enabled' and cs.value = 'true')
  )
  select o.player_id, 'eq'::text,
         coalesce((select string_agg(l.kit, ' + ' order by l.kit) from equipment_order_lines l where l.order_id = o.id), 'Экипировка'),
         o.ordered_on, o.total, o.paid, greatest(o.total - o.paid, 0)
  from equipment_orders o join kids k on k.pid = o.player_id
  union all
  select b.player_id, 'ind'::text, case when s.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end,
         s.starts_at::date, b.amount, case when b.paid then b.amount else 0 end, case when b.paid then 0 else b.amount end
  from individual_bookings b join individual_sessions s on s.id = b.session_id join kids k on k.pid = b.player_id
  where s.starts_at < local_now
  union all
  select b.player_id, 'extra'::text, 'Дополнительная тренировка' || coalesce(', ' || s.place, ''),
         s.starts_on, s.amount, case when b.paid then coalesce(b.paid_amount, s.amount) else 0 end,
         case when b.paid then greatest(s.amount - coalesce(b.paid_amount, s.amount), 0) else s.amount end
  from extra_bookings b join extra_sessions s on s.id = b.session_id join kids k on k.pid = b.player_id
  where s.starts_on <= today and s.cancelled_at is null
  union all
  select cp.player_id, 'camp'::text, c.name, c.starts_on, cp.amount, coalesce(pm.amt, 0), greatest(cp.amount - coalesce(pm.amt, 0), 0)
  from camp_participants cp join camps c on c.id = cp.camp_id join kids k on k.pid = cp.player_id
  left join lateral (select sum(x.amount) amt from camp_payments x where x.participant_id = cp.id) pm on true
  where cp.status = 'registered'
  order by 4 desc;
end $$;

create or replace function parent_calendar(p_player uuid, p_from date, p_to date)
returns table (
  event_id text, event_date date, event_time time, event_type text,
  title text, location text, event_status text, attendance_status text
)
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := current_user_id();
  player_group uuid;
  player_group_name text;
  player_club uuid;
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_player is null or p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 180 then raise exception 'date range too large' using errcode = '22023'; end if;
  if not exists (
    select 1 from player_guardians pg
    where pg.player_id = p_player and pg.user_id = me and pg.consent_revoked_at is null
  ) then raise exception 'forbidden' using errcode = '42501'; end if;

  select pl.group_id, gr.name, pl.club_id into player_group, player_group_name, player_club
  from players pl left join groups gr on gr.id = pl.group_id where pl.id = p_player;

  return query
  select e.event_id, e.event_date, e.event_time, e.event_type, e.title, e.location, e.event_status, e.attendance_status
  from (
    select
      ('match:' || m.id::text)::text as event_id, m.played_on as event_date, null::time as event_time, 'match'::text as event_type,
      coalesce(nullif(trim(m.opponent), ''), 'Матч')::text as title, null::text as location,
      case when m.goals_for is not null and m.goals_against is not null then 'completed'
           when m.played_on < (now() at time zone 'Asia/Tbilisi')::date then 'past'
           else 'upcoming' end::text as event_status,
      case when mp.played then 'played' when mp.match_id is not null then 'not_played' else null end::text as attendance_status
    from matches m
    left join match_players mp on mp.match_id = m.id and mp.player_id = p_player
    where m.played_on between p_from and p_to
      and (
        (player_group is not null and (
          m.team = player_group_name
          or (right(player_group_name, 2) in ('-A', '-B', '-C') and left(player_group_name, length(player_group_name) - 2) = m.team)
        ))
        or mp.player_id is not null
      )

    union all

    select * from (
    select distinct on (tl.held_on, tl.starts_at, tl.kind)
      ('training-log:' || tl.id::text)::text, tl.held_on, tl.starts_at, 'training'::text,
      case tl.kind when 'Вратарская' then 'Вратарская тренировка'
        when 'Индивидуальная' then 'Индивидуальная тренировка' else 'Тренировка' end::text,
      tl.location::text, 'past'::text, null::text
    from training_log tl
    where player_group is not null and tl.club_id = player_club
      and tl.group_label = player_group_name and tl.held and tl.held_on between p_from and p_to
      and not exists (
        select 1 from sessions s
        where s.group_id = player_group
          and (s.starts_at at time zone 'Asia/Tbilisi')::date = tl.held_on
      )
    order by tl.held_on, tl.starts_at, tl.kind, tl.id
    ) tlr

    union all

    select
      ('session:' || s.id::text)::text, (s.starts_at at time zone 'Asia/Tbilisi')::date,
      (s.starts_at at time zone 'Asia/Tbilisi')::time, 'training'::text,
      case when s.kind = 'training' then 'Групповая тренировка' else 'Тренировка' end::text,
      gr.location::text,
      case when (s.starts_at at time zone 'Asia/Tbilisi')::date < (now() at time zone 'Asia/Tbilisi')::date
        then 'past' else 'upcoming' end::text,
      a.status::text
    from sessions s
    join groups gr on gr.id = s.group_id
    left join attendance a on a.session_id = s.id and a.player_id = p_player
    where player_group is not null and s.group_id = player_group
      and (s.starts_at at time zone 'Asia/Tbilisi')::date between p_from and p_to

    union all

    -- Индивидуальные/вратарские занятия включаем только при активной записи именно этого ребёнка.
    select
      ('individual:' || ind.id::text)::text,
      ind.starts_at::date,
      ind.starts_at::time,
      'training'::text,
      (case when ind.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end
        || case when nullif(trim(ind.topic), '') is not null then ': ' || trim(ind.topic) else '' end)::text,
      null::text,
      case when ind.starts_at::date < (now() at time zone 'Asia/Tbilisi')::date then 'past' else 'upcoming' end::text,
      case when ib.attended then 'present' when ib.attended is false then 'absent' else null end::text
    from individual_sessions ind
    join individual_bookings ib on ib.session_id = ind.id and ib.player_id = p_player
    where ind.club_id = player_club
      and ind.starts_at::date between p_from and p_to

    union all

    -- Дополнительные занятия тоже доступны только если ребёнок записан на них.
    select
      ('extra:' || ex.id::text)::text,
      ex.starts_on,
      null::time,
      'training'::text,
      'Дополнительная тренировка'::text,
      ex.place::text,
      case when ex.starts_on < (now() at time zone 'Asia/Tbilisi')::date then 'past' else 'upcoming' end::text,
      case when eb.attended then 'present' when eb.attended is false then 'absent' else null end::text
    from extra_sessions ex
    join extra_bookings eb on eb.session_id = ex.id and eb.player_id = p_player
    where ex.club_id = player_club
      and ex.cancelled_at is null
      and ex.starts_on between p_from and p_to

    union all

    select
      ('schedule:' || ws.id::text || ':' || cal.day::date::text)::text,
      cal.day::date, ws.starts_at, 'training'::text,
      case ws.kind when 'Вратарская' then 'Вратарская тренировка'
        when 'Индивидуальная' then 'Индивидуальная тренировка' else 'Тренировка по расписанию' end::text,
      coalesce(ws.location, gr.location)::text, 'upcoming'::text, null::text
    from weekly_schedule ws
    join groups gr on gr.id = ws.group_id
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') cal(day)
    where player_group is not null and ws.group_id = player_group
      and extract(isodow from cal.day)::int = ws.weekday
      and cal.day::date >= (now() at time zone 'Asia/Tbilisi')::date
      and not exists (
        select 1 from sessions s
        where s.group_id = ws.group_id
          and (s.starts_at at time zone 'Asia/Tbilisi')::date = cal.day::date
          and (s.starts_at at time zone 'Asia/Tbilisi')::time = ws.starts_at
      )
      and not exists (
        select 1 from training_log tl where tl.club_id = gr.club_id
          and tl.group_label = player_group_name and tl.held and tl.held_on = cal.day::date
      )
  ) e
  order by e.event_date, e.event_time nulls last, e.event_type, e.event_id;
end;
$$;
