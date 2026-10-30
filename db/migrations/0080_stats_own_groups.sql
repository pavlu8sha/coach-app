-- 0080: статистика посещаемости и матчей у тренера только по его группам (решение владельца 2026-10-29). Администратор видит всё, как раньше.
-- Ограничение внутри самих функций: прямой вызов RPC тренером не отдаёт чужие цифры. Сигнатуры не меняются (match_stats по-прежнему с необязательным p_cat),
-- функции остаются с правами вызывающего, новых security definer нет.
-- Не затронуто: отметка посещаемости и ведение матчей любых команд (0042), «Учёт» (trainer_attendance, trainer_stats, match_staff_list), баллы.
-- Матч привязан к команде без суффикса (U10-A и U10-B → U10, 0055): тренер группы U10-A видит матчи команды U10 целиком, в том числе сыгранные составом U10-B.

create or replace function attendance_stats(p_from date, p_to date)
returns table (group_id uuid, group_name text, player_id uuid, full_name text, attended int, total int)
language plpgsql stable set search_path = public as $$
declare adm boolean := is_admin();
begin
  if current_user_id() is null or not (adm or exists (select 1 from coach_groups c where c.user_id = current_user_id())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  with held as (
    select s.id, s.group_id from sessions s
    where tbilisi_day(s.starts_at) between p_from and p_to
      and (adm or s.group_id in (select c.group_id from coach_groups c where c.user_id = current_user_id()))
      and exists (select 1 from attendance a where a.session_id = s.id and a.status = 'present')
  ), n as (
    select h.group_id, count(*)::int total from held h group by 1
  ), roster as (
    select pl.id pid, pl.group_id gid from players pl where pl.status = 'active' and pl.group_id is not null
    union
    select a.player_id, h.group_id from attendance a join held h on h.id = a.session_id
  )
  select g.id, g.name, p.id, p.full_name,
         (select count(*)::int from attendance a join held h on h.id = a.session_id
           where a.player_id = r.pid and h.group_id = r.gid and a.status = 'present'),
         n.total
  from roster r
  join n on n.group_id = r.gid
  join groups g on g.id = r.gid
  join players p on p.id = r.pid
  order by g.name, p.full_name;
end $$;
revoke execute on function attendance_stats(date, date) from public, anon;
grant execute on function attendance_stats(date, date) to authenticated;

create or replace function match_stats(p_from date, p_to date, p_cat text default null)
returns table (kind text, team text, name text, games int, wins int, draws int, losses int, goals_for int, goals_against int, played int, goals int)
language plpgsql stable set search_path = public as $$
declare adm boolean := is_admin();
begin
  if current_user_id() is null or not (adm or exists (select 1 from coach_groups c where c.user_id = current_user_id())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  if p_cat is not null and p_cat not in ('championship', 'festival', 'cup', 'friendly') then raise exception 'bad category' using errcode = '22023'; end if;
  return query
  with mine as (
    -- команды групп тренера: название группы без суффикса -A/-B/-C, как при записи матча (save_match, 0055)
    select distinct regexp_replace(g.name, '-[A-Z]$', '') as team
    from coach_groups c join groups g on g.id = c.group_id
    where c.user_id = current_user_id()
  ), m as (
    select x.id, x.team, x.goals_for gf, x.goals_against ga from matches x
    left join tournaments t on t.id = x.tournament_id
    where x.played_on between p_from and p_to and x.goals_for is not null and x.goals_against is not null
      and (p_cat is null or p_cat = case when x.kind = 'friendly' or t.id is null then 'friendly' else t.kind end)
      and (adm or regexp_replace(x.team, '-[A-Z]$', '') in (select mine.team from mine))
  )
  select 'team'::text, m.team, null::text,
         count(*)::int, count(*) filter (where m.gf > m.ga)::int, count(*) filter (where m.gf = m.ga)::int, count(*) filter (where m.gf < m.ga)::int,
         sum(m.gf)::int, sum(m.ga)::int, null::int, null::int
  from m group by m.team
  union all
  select 'player'::text, m.team, p.full_name, null::int, null::int, null::int, null::int, null::int, null::int,
         count(*) filter (where mp.played)::int, coalesce(sum(mp.goals), 0)::int
  from m join match_players mp on mp.match_id = m.id join players p on p.id = mp.player_id
  where mp.played or mp.goals > 0
  group by m.team, p.id, p.full_name
  order by 1, 2, 3;
end $$;
revoke execute on function match_stats(date, date, text) from public, anon;
grant execute on function match_stats(date, date, text) to authenticated;
