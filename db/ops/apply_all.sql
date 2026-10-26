-- Миграции 0059–0060 одной транзакцией. Сгенерировано scripts/make-apply-bundle.sh 0059.
-- Перед запуском выполните db/ops/preflight.sql: все номера от 0059 должны быть applied = false. После: db/ops/postcheck.sql.
begin;

-- ===== 0059_payment_for_month.sql =====
-- Платёж за месяц: реальная дата оплаты (paid_on) и месяц, за который платят (for_month). Родители платят за следующий месяц с 22 числа:
-- платёж лежит в журнале под настоящим числом, а засчитывается в месяц абонемента. Без for_month месяц берётся из paid_on, как раньше.
-- pay_month — готовый месяц платежа для расчётов: coalesce(for_month, первое число месяца paid_on).
alter table payments add column if not exists for_month date check (for_month is null or extract(day from for_month) = 1);
alter table payments add column if not exists pay_month date
  generated always as (coalesce(for_month, paid_on - (extract(day from paid_on)::int - 1))) stored;
create index if not exists payments_player_month_idx on payments (player_id, pay_month);

-- Долги по абонементу считают платежи по pay_month (было: месяц paid_on). Остальное без изменений (копия 0032).
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
         case when c.wo or (c.disc and c.pd > 0) then 0::numeric else greatest(c.t - c.pd, 0) end
  from calc c where c.t is not null
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
    and not (coalesce(s.discount, false) and coalesce(pm.amt, 0) > 0)
    and not coalesce(s.written_off, false)
  order by gr.name, pl.full_name;
end $$;

-- ===== 0060_event_roster_stats_kind.sql =====
-- 1) Состав события включает и тех, кто играл в играх события, даже если у них нет взноса (ушедшие и гости): статистика по ним остаётся видна.
create or replace function event_roster(t uuid)
returns table (player_id uuid, full_name text, group_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_staff();
  return query
    select p.id, p.full_name, g.name
      from players p left join groups g on g.id = p.group_id
     where p.id in (select f.player_id from tournament_fees f where f.tournament_id = t)
        or p.id in (select mp.player_id from match_players mp join matches m on m.id = mp.match_id where m.tournament_id = t)
     order by p.full_name;
end $$;

-- 2) Статистика матчей по виду: чемпионат, фестиваль, кубок, товарищеские (p_cat: championship, festival, cup, friendly; пусто — все).
drop function if exists match_stats(date, date);
create or replace function match_stats(p_from date, p_to date, p_cat text default null)
returns table (kind text, team text, name text, games int, wins int, draws int, losses int, goals_for int, goals_against int, played int, goals int)
language plpgsql stable set search_path = public as $$
begin
  if current_user_id() is null or not (is_admin() or exists (select 1 from coach_groups c where c.user_id = current_user_id())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'bad period' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'period too large' using errcode = '22023'; end if;
  if p_cat is not null and p_cat not in ('championship', 'festival', 'cup', 'friendly') then raise exception 'bad category' using errcode = '22023'; end if;
  return query
  with m as (
    select x.id, x.team, x.goals_for gf, x.goals_against ga from matches x
    left join tournaments t on t.id = x.tournament_id
    where x.played_on between p_from and p_to and x.goals_for is not null and x.goals_against is not null
      and (p_cat is null or p_cat = case when x.kind = 'friendly' or t.id is null then 'friendly' else t.kind end)
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

commit;
