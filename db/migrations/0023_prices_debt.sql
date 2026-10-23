-- Цены и долг по абонементу (docs/DEBT_RULES.md). Правила — как в старом приложении (Prices.js, Debtors.js):
-- долг за месяц = цена абонемента группы на этот месяц минус внесённые за месяц суммы;
-- у игрока со «Скидкой» месяц, за который что-то внесено, считается оплаченным.
-- Родителю долг показывается только после включения клубной настройки parent_debt_enabled = 'true'
-- (администратор включает её, когда внесены скидки): иначе у детей со скидкой мог бы появиться неверный долг.

-- 1. Цены по умолчанию, как в старом приложении (PRICE_DEFAULTS). Действуют с начала сезона; идемпотентно.
insert into prices (club_id, group_id, kind, amount, valid_from)
  select c.id, null, 'subscription', 165, date '2026-09-01' from clubs c
  where not exists (select 1 from prices p where p.club_id = c.id and p.kind = 'subscription' and p.group_id is null);
insert into prices (club_id, group_id, kind, amount, valid_from)
  select c.id, g.id, 'subscription', 130, date '2026-09-01' from clubs c join groups g on g.club_id = c.id and lower(g.name) = 'weekends'
  where not exists (select 1 from prices p where p.group_id = g.id and p.kind = 'subscription');
insert into prices (club_id, group_id, kind, amount, valid_from)
  select c.id, null, 'individual', 50, date '2026-09-01' from clubs c
  where not exists (select 1 from prices p where p.club_id = c.id and p.kind = 'individual');

-- 2. Цена абонемента группы на месяц: своя цена группы важнее общей; из подходящих — с самой поздней датой начала.
create or replace function tariff_for(c uuid, g uuid, m date) returns numeric
language sql stable security definer set search_path = public as $$
  select amount from prices
   where club_id = c and kind = 'subscription' and valid_from <= m and (valid_to is null or valid_to >= m)
     and (group_id = g or group_id is null)
   order by (group_id is not null) desc, valid_from desc limit 1
$$;

-- Первый месяц, с которого считается долг (решение Павла 2026-10-23: с начала сезона).
create or replace function debt_start() returns date language sql immutable as $$ select date '2026-09-01' $$;

-- 3. Долг для родителя: только его дети (с действующим согласием). Текущий месяц — всегда; прошлые (с начала сезона) —
-- только если за месяц есть строка абонемента: так «новый» игрок не получает долг за месяцы до прихода.
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
    select k.pid, k.club_id, mo.m, coalesce(s.group_id, k.gid) g, coalesce(s.discount, false) disc
    from kids k cross join mon mo
    left join subscriptions s on s.player_id = k.pid and s.month = mo.m
    where mo.m = cur or s.id is not null
  ), paid_m as (
    select p.player_id pid, date_trunc('month', p.paid_on)::date m, sum(p.amount) amt from payments p group by 1, 2
  ), calc as (
    select b.pid, b.m, tariff_for(b.club_id, b.g, b.m) t, coalesce(pm.amt, 0) pd, b.disc
    from base b
    left join paid_m pm on pm.pid = b.pid and pm.m = b.m
    left join groups gr on gr.id = b.g
    where coalesce(lower(gr.name), '') <> 'индивидуальные / вратарские'
  )
  select c.pid, c.m, c.t, c.pd,
         case when c.disc and c.pd > 0 then 0::numeric else greatest(c.t - c.pd, 0) end
  from calc c where c.t is not null
  order by c.m desc, c.pid;
end $$;

-- 4. Должники за месяц для администратора: активные игроки групп, у которых за месяц оплата неполная.
-- Прошлые месяцы — только игроки со строкой абонемента за этот месяц; текущий — все активные.
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
  order by gr.name, pl.full_name;
end $$;

revoke execute on function tariff_for(uuid, uuid, date), debt_start(), parent_debts(), debtors(date) from public;
grant execute on function parent_debts(), debtors(date) to authenticated;
-- tariff_for и debt_start — служебные, вызываются только изнутри функций выше.
