-- 0230: следующий месяц с N-го числа считается долгом, не оплатой «вперёд» (настройка payments.nextMonthDay, по умолчанию 22). Условия: docs/PAY_MODE_RETURN_AND_NEXT_MONTH_ACCEPTANCE.md, часть B.
-- Решение владельца 2026-11-27. Новая служебная debt_month_limit(club, strict, day): последний месяц, за который считается долг. Изменены: debtors(m) и parent_debts() (следующий месяц с порога).
-- Тела взяты из последних определений (0200; grep -lEi "function +(public\.)?(debtors|parent_debts) *\(" db/migrations/*.sql: parent_debts также в 0173, последнее 0200). parent_dues и cash_report не меняются (абонемент в них не считается).
-- Откат: db/ops/rollback-0230-next-month-due.sql. Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

-- Последний месяц долга: текущий, а с дня nextMonthDay (в коротком месяце — не позже его последнего дня) следующий.
-- strict: недопустимая настройка — ошибка (экран администратора); не strict (кабинет родителя) — следующий месяц не показывается.
create or replace function debt_month_limit(c uuid, strict boolean default true, d date default null) returns date
language plpgsql stable security definer set search_path = public as $$
declare today date := coalesce(d, tbilisi_day(now())); v text; n numeric; last_day int;
begin
  select nullif(trim(value), '') into v from club_settings where club_id = c and key = 'payments.nextMonthDay';
  if v is null then n := 22;
  else
    begin
      n := replace(v, ',', '.')::numeric;
    exception when others then
      n := null;
    end;
    if n is null or n <> trunc(n) or n < 1 or n > 31 then
      if strict then raise exception 'invalid setting payments.nextMonthDay: %', v using errcode = '22023'; end if;
      return date_trunc('month', today)::date;
    end if;
  end if;
  last_day := extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))::int;
  if extract(day from today)::int >= least(n::int, last_day) then return (date_trunc('month', today) + interval '1 month')::date; end if;
  return date_trunc('month', today)::date;
end $$;
revoke execute on function debt_month_limit(uuid, boolean, date) from public, anon, authenticated;

create or replace function debtors(m date)
returns table (group_name text, player_id uuid, full_name text, tariff numeric, paid numeric, debt numeric, discount boolean)
language plpgsql stable security definer set search_path = public as $$
declare cur date := date_trunc('month', tbilisi_day(now()))::date; mm date := date_trunc('month', m)::date; lim date;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  lim := debt_month_limit(club_event_current_club(), true);
  if mm < debt_start() or mm > lim then raise exception 'month out of range'; end if;
  return query
  select gr.name, pl.id, pl.full_name, t.tariff, coalesce(pm.amt, 0), greatest(t.tariff - coalesce(pm.amt, 0), 0), coalesce(s.discount, false)
  from players pl
  left join subscriptions s on s.player_id = pl.id and s.month = mm
  join groups gr on gr.id = coalesce(s.group_id, pl.group_id)
  cross join lateral (select tariff_for(pl.club_id, gr.id, mm) as tariff) t
  left join lateral (select sum(p.amount) amt from payments p where p.player_id = pl.id and p.pay_month = mm) pm on true
  where pl.status = 'active' and t.tariff is not null
    and lower(gr.name) <> 'индивидуальные / вратарские'
    and (mm >= cur or s.id is not null)
    and coalesce(pm.amt, 0) < t.tariff
    and not coalesce(s.discount, false)
    and not coalesce(s.written_off, false)
    and not player_per_visit_month(pl.id, mm)
    and (coalesce(pm.amt, 0) > 0 or not player_paused_month(pl.id, mm))
  order by gr.name, pl.full_name;
end $$;

CREATE OR REPLACE FUNCTION public.parent_debts()
 RETURNS TABLE(player_id uuid, month date, tariff numeric, paid numeric, debt numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cur date := date_trunc('month', tbilisi_day(now()))::date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
  with kids as (
    select pl.id pid, pl.club_id, pl.group_id gid
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.user_id = current_user_id() and parent_access_ok(pg.user_id, pg.player_id)
    where pl.status = 'active'
      and exists (select 1 from club_settings cs where cs.club_id = pl.club_id and cs.key = 'parent_debt_enabled' and cs.value = 'true')
  ), mon as (
    select generate_series(debt_start(), (cur + interval '1 month')::date, interval '1 month')::date m
  ), base as (
    select k.pid, k.club_id, mo.m, coalesce(s.group_id, k.gid) g, coalesce(s.discount, false) disc, coalesce(s.written_off, false) wo
    from kids k cross join mon mo
    left join subscriptions s on s.player_id = k.pid and s.month = mo.m
    where (mo.m >= cur or s.id is not null) and mo.m <= debt_month_limit(k.club_id, false)
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
    and not player_per_visit_month(c.pid, c.m)
    and (c.pd > 0 or not player_paused_month(c.pid, c.m))
  order by c.m desc, c.pid;
end $function$;

commit;
