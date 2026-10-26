-- Что отметили тренеры за день. Только чтение. Поменяйте дату в первой строке (по умолчанию — сегодня по Тбилиси).
with p as (select (now() at time zone 'Asia/Tbilisi')::date as d)  -- замените на, например, date '2026-11-01'
select g.name as группа,
       coalesce(max(u.display_name), '—') as кто_отметил,
       count(a.player_id) as отметок,
       count(a.player_id) filter (where a.status = 'present') as были,
       count(a.player_id) filter (where a.status = 'absent') as не_были,
       count(a.player_id) filter (where a.status = 'excused') as уважительная,
       (select count(*) from players pl where pl.group_id = g.id and pl.status = 'active') as активных_в_группе,
       exists (select 1 from weekly_schedule w where w.group_id = g.id and w.weekday = extract(isodow from (select d from p))::int) as по_расписанию
from groups g
left join sessions s on s.group_id = g.id and (s.starts_at at time zone 'Asia/Tbilisi')::date = (select d from p)
left join attendance a on a.session_id = s.id
left join users u on u.id = a.marked_by
group by g.id, g.name
having count(a.player_id) > 0
    or exists (select 1 from weekly_schedule w where w.group_id = g.id and w.weekday = extract(isodow from (select d from p))::int)
order by (count(a.player_id) = 0) desc, g.name;
