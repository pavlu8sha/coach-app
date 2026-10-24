-- Долги: «Списано» и создание абонементов на месяц (перенос из старого приложения: appDebtWrote, appCreatePayMonth).
-- Списанный долг не показывается ни администратору в «Должниках», ни родителю. Списание ставит администратор
-- (subscriptions.written_off, запись остаётся: можно снять); платежи не трогаются.
alter table subscriptions add column if not exists written_off boolean not null default false;

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
    select p.player_id pid, date_trunc('month', p.paid_on)::date m, sum(p.amount) amt from payments p group by 1, 2
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
  left join lateral (select sum(p.amount) amt from payments p where p.player_id = pl.id and date_trunc('month', p.paid_on)::date = mm) pm on true
  where pl.status = 'active' and t.tariff is not null
    and lower(gr.name) <> 'индивидуальные / вратарские'
    and (mm = cur or s.id is not null)
    and coalesce(pm.amt, 0) < t.tariff
    and not (coalesce(s.discount, false) and coalesce(pm.amt, 0) > 0)
    and not coalesce(s.written_off, false)
  order by gr.name, pl.full_name;
end $$;

-- Создать строки абонементов на месяц для активных игроков с группой (кроме групп «Индивидуальные / Вратарские»).
-- Уже существующие строки не трогаются. Возвращает число созданных. Месяц: не раньше начала сезона и не позже следующего.
create or replace function create_subscription_month(m date) returns int
language plpgsql security definer set search_path = public as $$
declare mm date := date_trunc('month', m)::date; cur date := date_trunc('month', tbilisi_day(now()))::date; n int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mm < debt_start() or mm > (cur + interval '1 month')::date then raise exception 'month out of range' using errcode = '22023'; end if;
  insert into subscriptions (player_id, group_id, month, amount_due)
  select pl.id, pl.group_id, mm, coalesce(tariff_for(pl.club_id, pl.group_id, mm), 0)
  from players pl join groups gr on gr.id = pl.group_id
  where pl.status = 'active' and lower(gr.name) <> 'индивидуальные / вратарские'
  on conflict (player_id, month) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function create_subscription_month(date) from public, anon;
grant execute on function create_subscription_month(date) to authenticated;
