-- Баллы считаются с запуска приложения (решение владельца 2026-10-24): родители не должны получить приложение с уже набранными баллами.
-- Дата старта хранится в club_settings (ключ points_start). Пока дата не задана, ограничения нет. Когда задана, баллы раньше этой даты
-- (occurred_on) не видит никто через приложение: ни родитель и ребёнок, ни тренер, ни администратор, и они не входят в рейтинг группы.
-- Записи в журнале не удаляются: историю можно вернуть, очистив дату старта.
create or replace function points_start() returns date
language sql stable security definer set search_path = public as $$
  select case when value ~ '^\d{4}-\d{2}-\d{2}$' then value::date end from club_settings where key = 'points_start' and scope = '' limit 1
$$;
revoke execute on function points_start() from public, anon;
grant execute on function points_start() to authenticated;

drop policy if exists points_read on point_events;
create policy points_read on point_events for select
  using ((is_admin() or is_coach_of_player(player_id) or is_guardian_of(player_id) or is_self_player(player_id))
         and occurred_on >= coalesce(points_start(), '-infinity'::date));

create or replace function group_rating(p_group uuid, p_season uuid default null)
returns table (group_id uuid, total_points bigint, players_count bigint)
language sql stable security definer set search_path = public as $$
  select g.id,
         coalesce(sum(e.points), 0)::bigint,
         count(distinct pl.id)::bigint
  from groups g
  join players pl on pl.group_id = g.id and pl.status = 'active'
  left join point_events e on e.player_id = pl.id and e.occurred_on >= coalesce(points_start(), '-infinity'::date)
  where g.id = p_group
    and (auth.uid() is not null)
  group by g.id
$$;

-- Администратор задаёт дату старта (null — снять ограничение)
create or replace function set_points_start(d date) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into c from clubs order by id limit 1;
  if d is null then
    delete from club_settings where club_id = c and key = 'points_start' and scope = '';
  else
    insert into club_settings (club_id, key, value, scope, updated_at) values (c, 'points_start', to_char(d, 'YYYY-MM-DD'), '', current_date)
    on conflict (club_id, key, scope) do update set value = excluded.value, updated_at = excluded.updated_at;
  end if;
end $$;
revoke execute on function set_points_start(date) from public, anon;
grant execute on function set_points_start(date) to authenticated;
