-- Статистика посещаемости по группам за период (перенос «Статистики» из старого приложения: appStatsRange).
-- Занятие считается проведённым, если на нём отмечен хотя бы один «был». Функция работает с правами вызывающего (RLS):
-- администратор видит все группы, тренер — свои. Родителям и остальным недоступна.
create or replace function attendance_stats(p_from date, p_to date)
returns table (group_id uuid, group_name text, player_id uuid, full_name text, attended int, total int)
language plpgsql stable set search_path = public as $$
begin
  if current_user_id() is null or not (is_admin() or exists (select 1 from coach_groups c where c.user_id = current_user_id())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  with held as (
    select s.id, s.group_id from sessions s
    where tbilisi_day(s.starts_at) between p_from and p_to
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
