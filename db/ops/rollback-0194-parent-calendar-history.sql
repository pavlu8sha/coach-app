-- ОТКАТ 0194: возвращает parent_calendar к телу из 0178 (по текущей группе; без фильтра жизненного цикла матчей).
-- После отката вернутся дефекты #628 и #629. Сначала db/ops/preflight.sql.
CREATE OR REPLACE FUNCTION public.parent_calendar(p_player uuid, p_from date, p_to date)
 RETURNS TABLE(event_id text, event_date date, event_time time without time zone, event_type text, title text, location text, event_status text, attendance_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    where pg.player_id = p_player and pg.user_id = me and parent_access_ok(pg.user_id, pg.player_id)
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
      and m.lifecycle_status in ('legacy', 'published')
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
    where tl.club_id = player_club
      and tl.group_label = (select gh.name from groups gh where gh.id = points_group_at(p_player, tl.held_on))
      and tl.held and tl.held_on between p_from and p_to
      and not exists (
        select 1 from sessions s
        where s.group_id = points_group_at(p_player, tl.held_on)
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
    where (s.group_id = points_group_at(p_player, tbilisi_day(s.starts_at)) or a.player_id is not null)
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

    -- Разовое посещение тренировки другой группы (0178): только сам гость; родители группы-хозяина его не видят
    select
      ('guest:' || gs.id::text)::text,
      tbilisi_day(gs.starts_at),
      (gs.starts_at at time zone 'Asia/Tbilisi')::time,
      'training'::text,
      ('Разовое посещение: ' || gg.name)::text,
      gg.location::text,
      case when tbilisi_day(gs.starts_at) < (now() at time zone 'Asia/Tbilisi')::date then 'past' else 'upcoming' end::text,
      'present'::text
    from session_guests sg
    join sessions gs on gs.id = sg.session_id
    join groups gg on gg.id = gs.group_id
    where sg.player_id = p_player
      and tbilisi_day(gs.starts_at) between p_from and p_to

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
$function$;

revoke all on function parent_calendar(uuid, date, date) from public, anon;
grant execute on function parent_calendar(uuid, date, date) to authenticated;
