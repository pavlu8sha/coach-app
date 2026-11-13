-- 0183: личная лента тренировок игрока для профиля (#266, этап 2). Условия П2.1–П2.10: docs/PLAYER_PROFILE_ACCEPTANCE.md.
--  * player_training_history(игрок, с, по): прошедшие групповые занятия с отметкой игрока, занятия его группы на дату без отметки (unmarked),
--    разовые посещения других групп, индивидуальные/вратарские и дополнительные записи этого игрока. Только чтение.
--  * Доступ: администратор, тренер текущей группы игрока, родитель с действующим доступом, сам ребёнок. Правило 0042 (тренеры видят все группы)
--    сюда не переносится. Наружу не уходят id, имена, суммы и оплаты.
--  * Занятие без отметки игрока выдаётся только если: группа игрока на этот день по player_group_history; занятие проведено (есть отметка «был»);
--    день не раньше первой отметки игрока; игрок в этот день не на паузе и не ушёл (player_status_log) и не позже players.ends_on.
-- Новая функция; существующие функции и таблицы не меняются. Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

create or replace function player_training_history(p uuid, p_from date, p_to date)
returns table (day date, starts_at time, kind text, title text, group_name text, status text)
language plpgsql stable security definer set search_path = public as $$
declare
  pl players;
  t_to date;
  first_mark date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into pl from players where id = p;
  if pl.id is null or not (is_admin() or is_coach_of_player(p) or is_guardian_of(p) or is_self_player(p)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  t_to := least(p_to, tbilisi_day(now()));

  -- Первая отметка игрока: на групповом занятии или разовом посещении
  select min(d) into first_mark from (
    select min(tbilisi_day(s.starts_at)) d from attendance a join sessions s on s.id = a.session_id where a.player_id = p
    union all
    select min(tbilisi_day(s.starts_at)) from session_guests g join sessions s on s.id = g.session_id where g.player_id = p
  ) x;

  return query
  select e.day, e.starts_at, e.kind, e.title, e.group_name, e.status
  from (
    -- групповые занятия с отметкой игрока (любая группа)
    select tbilisi_day(s.starts_at) as day, (s.starts_at at time zone 'Asia/Tbilisi')::time as starts_at, 'group'::text as kind,
           'Групповая тренировка'::text as title, gr.name::text as group_name, a.status::text as status
    from attendance a
    join sessions s on s.id = a.session_id
    join groups gr on gr.id = s.group_id
    where a.player_id = p and tbilisi_day(s.starts_at) between p_from and t_to

    union all

    -- проведённые занятия группы игрока на дату, где его не отметили
    select tbilisi_day(s.starts_at), (s.starts_at at time zone 'Asia/Tbilisi')::time, 'group', 'Групповая тренировка', gr.name::text, 'unmarked'
    from sessions s
    join groups gr on gr.id = s.group_id
    where first_mark is not null
      and tbilisi_day(s.starts_at) between greatest(p_from, first_mark) and t_to
      and (pl.ends_on is null or tbilisi_day(s.starts_at) <= pl.ends_on)
      and s.group_id = points_group_at(p, tbilisi_day(s.starts_at))
      and exists (select 1 from attendance x where x.session_id = s.id and x.status = 'present')
      and not exists (select 1 from attendance x where x.session_id = s.id and x.player_id = p)
      and not exists (select 1 from session_guests x where x.session_id = s.id and x.player_id = p)
      and coalesce((select l.status from player_status_log l
                     where l.player_id = p and l.on_date <= tbilisi_day(s.starts_at)
                     order by l.on_date desc, l.created_at desc limit 1), 'active') = 'active'

    union all

    -- разовое посещение тренировки другой группы (0178)
    select tbilisi_day(s.starts_at), (s.starts_at at time zone 'Asia/Tbilisi')::time, 'guest', ('Разовое посещение: ' || gr.name)::text, gr.name::text, 'present'
    from session_guests g
    join sessions s on s.id = g.session_id
    join groups gr on gr.id = s.group_id
    where g.player_id = p and tbilisi_day(s.starts_at) between p_from and t_to

    union all

    -- индивидуальные и вратарские: только записи этого игрока (starts_at — местное время клуба)
    select i.starts_at::date, i.starts_at::time,
           case when i.goalkeepers then 'goalkeeper' else 'individual' end,
           (case when i.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end
             || case when nullif(btrim(i.topic), '') is not null then ': ' || btrim(i.topic) else '' end)::text,
           null::text,
           case when b.attended then 'present' when b.attended is false then 'absent' else 'unmarked' end
    from individual_bookings b
    join individual_sessions i on i.id = b.session_id
    where b.player_id = p and i.club_id = pl.club_id and i.starts_at::date between p_from and t_to

    union all

    -- дополнительные: только записи этого игрока, без отменённых занятий
    select x.starts_on, x.starts_time, 'extra', 'Дополнительная тренировка', null::text,
           case when b.attended then 'present' when b.attended is false then 'absent' else 'unmarked' end
    from extra_bookings b
    join extra_sessions x on x.id = b.session_id
    where b.player_id = p and x.club_id = pl.club_id and x.cancelled_at is null and x.starts_on between p_from and t_to
  ) e
  order by e.day desc, e.starts_at desc nulls last, e.kind;
end $$;

revoke execute on function player_training_history(uuid, date, date) from public, anon;
grant execute on function player_training_history(uuid, date, date) to authenticated;

commit;
