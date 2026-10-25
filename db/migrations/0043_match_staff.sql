-- Штат матча (тренер и оператор) и статистика тренеров: перенос листа «Игры» (столбцы F–H) и вкладок «Игры» и «Статистика»
-- страницы «Посещаемость тренеров» старого приложения. Запись — только администратор; читают администратор и тренеры.
-- Часы тренировок тренерам не показываются (как в 0042). Оплаты тренерам не считаются.
create table match_staff (
  match_id uuid not null references matches(id) on delete cascade,
  coach text not null,
  role text not null check (role in ('Тренер', 'Оператор')),
  reg boolean not null default true,   -- регламент выполнен
  primary key (match_id, coach, role)
);
alter table match_staff enable row level security;
create policy match_staff_admin on match_staff for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on match_staff to authenticated, service_role;

-- Заменить штат матча целиком. staff: [{coach, role, reg}]
create or replace function match_staff_set(m uuid, staff jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare el jsonb; c text; r text;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from matches where id = m) then raise exception 'not found' using errcode = 'P0002'; end if;
  if staff is null or jsonb_typeof(staff) <> 'array' then raise exception 'bad staff' using errcode = '22023'; end if;
  delete from match_staff where match_id = m;
  for el in select * from jsonb_array_elements(staff) loop
    c := nullif(trim(el->>'coach'), '');
    r := el->>'role';
    if c is null then raise exception 'fields required' using errcode = '22023'; end if;
    if r not in ('Тренер', 'Оператор') then raise exception 'bad role' using errcode = '22023'; end if;
    insert into match_staff (match_id, coach, role, reg) values (m, c, r, coalesce((el->>'reg')::boolean, true))
      on conflict (match_id, coach, role) do update set reg = excluded.reg;
  end loop;
end $$;

-- Игры периода со штатом
create or replace function match_staff_list(p_from date, p_to date)
returns table (match_id uuid, played_on date, team text, opponent text, goals_for int, goals_against int, staff jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null or not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  select mt.id, mt.played_on, mt.team, mt.opponent, mt.goals_for, mt.goals_against,
    coalesce((select jsonb_agg(jsonb_build_object('coach', s.coach, 'role', s.role, 'reg', s.reg) order by s.role desc, s.coach)
              from match_staff s where s.match_id = mt.id), '[]'::jsonb)
  from matches mt
  where mt.played_on between p_from and p_to and mt.goals_for is not null
  order by mt.played_on, mt.team;
end $$;

-- Статистика по тренерам: проведённые тренировки (часы только администратору), игры как тренер и как оператор, участия, % регламента
create or replace function trainer_stats(p_from date, p_to date)
returns table (coach text, trainings int, hours numeric, as_coach int, as_operator int, parts int, reg_pct int)
language plpgsql stable security definer set search_path = public as $$
declare adm boolean;
begin
  if current_user_id() is null or not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  adm := is_admin();
  return query
  with t as (
    select l.coach as n, count(*)::int as c, sum(coalesce(l.hours, 0)) as h
    from training_log l where l.held and l.held_on between p_from and p_to group by l.coach
  ), g as (
    select s.coach as n,
      count(*) filter (where s.role = 'Тренер')::int as ac,
      count(*) filter (where s.role = 'Оператор')::int as ao,
      count(*)::int as p,
      count(*) filter (where s.reg)::int as r
    from match_staff s join matches mt on mt.id = s.match_id
    where mt.played_on between p_from and p_to group by s.coach
  )
  select coalesce(t.n, g.n), coalesce(t.c, 0), case when adm then round(coalesce(t.h, 0), 1) end,
    coalesce(g.ac, 0), coalesce(g.ao, 0), coalesce(g.p, 0),
    case when coalesce(g.p, 0) > 0 then round(g.r * 100.0 / g.p)::int end
  from t full join g on t.n = g.n
  order by 1;
end $$;

revoke execute on function match_staff_set(uuid, jsonb), match_staff_list(date, date), trainer_stats(date, date) from public, anon;
grant execute on function match_staff_set(uuid, jsonb), match_staff_list(date, date), trainer_stats(date, date) to authenticated;
