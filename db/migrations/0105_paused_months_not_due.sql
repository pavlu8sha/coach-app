-- Месяц целиком на паузе не оплачивается, даже когда игрок уже вернулся (решение Павла 2026-11-02).
-- Паузу берём из журнала player_status_log (0104). Месяц «на паузе», если пауза началась не позже его 1-го числа,
-- а следующая запись журнала (возвращение, уход или новая пауза) не раньше 1-го числа следующего месяца или её ещё нет.
-- Месяц возвращения посреди месяца и месяц начала паузы посреди месяца остаются платными. Если за месяц паузы внесены деньги, долг считается как обычно.
-- Остальное в parent_debts() и debtors() без изменений (копия 0093).
begin;

create or replace function player_paused_month(pid uuid, m date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from (
      select l.status, l.on_date,
             lead(l.on_date) over (order by l.on_date, l.created_at) as next_on
      from player_status_log l where l.player_id = pid
    ) x
    where x.status = 'paused'
      and x.on_date <= date_trunc('month', m)::date
      and (x.next_on is null or x.next_on >= (date_trunc('month', m) + interval '1 month')::date)
  )
$$;
-- только для функций долга (они выполняются от владельца): снаружи журнал паузы не открываем
revoke execute on function player_paused_month(uuid, date) from public, anon, authenticated;

create or replace function parent_debts()
returns table (player_id uuid, month date, tariff numeric, paid numeric, debt numeric)
language plpgsql stable security definer set search_path = public as $$
declare cur date := date_trunc('month', tbilisi_day(now()))::date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
  with kids as (
    select pl.id pid, pl.club_id, pl.group_id gid
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.user_id = current_user_id() and pg.consent_revoked_at is null
    where pl.status = 'active'
      and exists (select 1 from club_settings cs where cs.club_id = pl.club_id and cs.key = 'parent_debt_enabled' and cs.value = 'true')
  ), mon as (
    select generate_series(debt_start(), cur, interval '1 month')::date m
  ), base as (
    select k.pid, k.club_id, mo.m, coalesce(s.group_id, k.gid) g, coalesce(s.discount, false) disc, coalesce(s.written_off, false) wo
    from kids k cross join mon mo
    left join subscriptions s on s.player_id = k.pid and s.month = mo.m
    where mo.m = cur or s.id is not null
  ), paid_m as (
    select p.player_id pid, p.pay_month m, sum(p.amount) amt from payments p group by 1, 2
  ), calc as (
    select b.pid, b.m, tariff_for(b.club_id, b.g, b.m) t, coalesce(pm.amt, 0) pd, b.disc, b.wo
    from base b
    left join paid_m pm on pm.pid = b.pid and pm.m = b.m
    left join groups gr on gr.id = b.g
    where coalesce(lower(gr.name), '') <> 'индивидуальные / вратарские'
  )
  select c.pid, c.m, c.t, c.pd,
         case when c.wo or c.disc then 0::numeric else greatest(c.t - c.pd, 0) end
  from calc c where c.t is not null
    and (c.pd > 0 or not player_paused_month(c.pid, c.m))
  order by c.m desc, c.pid;
end $$;


create or replace function debtors(m date)
returns table (group_name text, player_id uuid, full_name text, tariff numeric, paid numeric, debt numeric, discount boolean)
language plpgsql stable security definer set search_path = public as $$
declare cur date := date_trunc('month', tbilisi_day(now()))::date; mm date := date_trunc('month', m)::date;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mm < debt_start() or mm > cur then raise exception 'month out of range'; end if;
  return query
  select gr.name, pl.id, pl.full_name, t.tariff, coalesce(pm.amt, 0), greatest(t.tariff - coalesce(pm.amt, 0), 0), coalesce(s.discount, false)
  from players pl
  left join subscriptions s on s.player_id = pl.id and s.month = mm
  join groups gr on gr.id = coalesce(s.group_id, pl.group_id)
  cross join lateral (select tariff_for(pl.club_id, gr.id, mm) as tariff) t
  left join lateral (select sum(p.amount) amt from payments p where p.player_id = pl.id and p.pay_month = mm) pm on true
  where pl.status = 'active' and t.tariff is not null
    and lower(gr.name) <> 'индивидуальные / вратарские'
    and (mm = cur or s.id is not null)
    and coalesce(pm.amt, 0) < t.tariff
    and not coalesce(s.discount, false)
    and not coalesce(s.written_off, false)
    and (coalesce(pm.amt, 0) > 0 or not player_paused_month(pl.id, mm))
  order by gr.name, pl.full_name;
end $$;

commit;
