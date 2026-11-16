-- 0200: оплата за визит — игрок без абонемента платит 20 ₾ за каждое посещение своей группы. Условия приёмки: docs/PAY_PER_VISIT_ACCEPTANCE.md.
-- Решения владельца 2026-11-16: вариант A; тип игрока ставится вручную в карточке; цена одна для всех (20 ₾); неоплаченный визит копится как долг.
--  * players.pay_mode ('subscription' | 'per_visit') и pay_mode_from; меняет только администратор (player_set_pay_mode), изменение пишется в audit_log.
--  * own_visits: визит игрока за визит, создаётся триггером на attendance при «Был» (с даты pay_mode_from), сумма из настройки own_visit.fee (по умолчанию 20) фиксируется в строке.
--  * Оплата: own_visit_set_paid, журнал service_payments вида own_visit (ref_id = занятие). Абонемент (payments, subscriptions) не трогается.
--  * Игрок за визит не попадает в debtors, parent_debts и автосоздание абонементов за месяцы с месяца pay_mode_from; прошлые месяцы считаются как раньше.
--  * Долг за визит виден в parent_dues (вид own_visit) и в «Кассе» (отдельный раздел). player_visit_month: итог за месяц для карточки.
--  * Название «Разовое посещение» (доп. посещение чужой группы, 0178) в кассе, оплатах и календаре заменено на «Доп. посещение»; вид visit и таблица session_guests не менялись.
-- Тела debtors (0105), parent_debts (0173), subscription_month_auto/missing (0128), parent_dues (0185), cash_report/cash_day_service (0188), parent_calendar (0194),
-- player_training_history (0183) взяты из последних определений и изменены только перечисленным выше (урок 2026-11-11): перед применением обновить ветку с master и пересобрать тела, если эти функции менялись после перечисленных миграций.
-- Откат: db/ops/rollback-0200-pay-per-visit.sql. Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

-- 1. Тип игрока
alter table players add column if not exists pay_mode text not null default 'subscription' check (pay_mode in ('subscription', 'per_visit'));
alter table players add column if not exists pay_mode_from date;
alter table players drop constraint if exists players_pay_mode_from_check;
alter table players add constraint players_pay_mode_from_check check ((pay_mode = 'per_visit') = (pay_mode_from is not null));

-- 2. Визиты за плату
create table if not exists own_visits (
  session_id uuid not null references sessions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  paid boolean not null default false,
  paid_amount numeric(10,2) check (paid_amount is null or paid_amount >= 0),
  method text check (method is null or method in ('Наличные', 'Перевод')),
  created_at timestamptz not null default now(),
  primary key (session_id, player_id)
);
create index if not exists own_visits_player on own_visits (player_id);
alter table own_visits enable row level security;
revoke all on own_visits from public, anon, authenticated;
grant select on own_visits to authenticated;
grant all on own_visits to service_role;
drop policy if exists own_visits_read on own_visits;
create policy own_visits_read on own_visits for select
  using (is_admin() or is_any_coach() or is_guardian_of(player_id) or is_self_player(player_id));

-- 3. Новый вид оплаты в журнале
alter table service_payments drop constraint if exists service_payments_kind_check;
alter table service_payments add constraint service_payments_kind_check check (kind in ('equipment', 'individual', 'extra', 'visit', 'own_visit'));

-- 4. Служебные функции
-- Цена визита: настройка own_visit.fee, пустая — 20; недопустимое значение не подменяем молча
create or replace function own_visit_fee(c uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v text; n numeric;
begin
  select nullif(trim(value), '') into v from club_settings where club_id = c and key = 'own_visit.fee';
  if v is null then return 20; end if;
  begin
    n := replace(v, ',', '.')::numeric;
  exception when others then
    n := null;
  end;
  if n is null or n = 'NaN'::numeric or n < 0 or n > 10000 then raise exception 'invalid setting own_visit.fee: %', v using errcode = '22023'; end if;
  return round(n, 2);
end $$;
revoke execute on function own_visit_fee(uuid) from public, anon, authenticated;

-- Месяц игрока «за визит»: с месяца pay_mode_from и пока тип действует
create or replace function player_per_visit_month(pid uuid, m date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players p where p.id = pid and p.pay_mode = 'per_visit' and p.pay_mode_from is not null
                   and date_trunc('month', p.pay_mode_from)::date <= date_trunc('month', m)::date)
$$;
revoke execute on function player_per_visit_month(uuid, date) from public, anon, authenticated;

-- 5. Тип игрока: только администратор. Возврат к абонементу очищает дату; прошлые визиты и платежи остаются.
create or replace function player_set_pay_mode(p uuid, mode text, from_d date default null) returns void
language plpgsql security definer set search_path = public as $$
declare pl players; nf date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mode is null or mode not in ('subscription', 'per_visit') then raise exception 'bad pay mode' using errcode = '22023'; end if;
  select * into pl from players where id = p for update;
  if not found then raise exception 'player not found' using errcode = 'P0002'; end if;
  nf := case when mode = 'per_visit' then coalesce(from_d, tbilisi_day(now())) else null end;
  if nf is not null and nf > tbilisi_day(now()) then raise exception 'date in the future' using errcode = '22023'; end if;
  if pl.pay_mode = mode and pl.pay_mode_from is not distinct from nf then return; end if;
  update players set pay_mode = mode, pay_mode_from = nf where id = p;
  insert into audit_log (actor_id, action, entity, entity_id, before, after)
  values (current_user_id(), 'player_pay_mode', 'players', p,
          jsonb_build_object('pay_mode', pl.pay_mode, 'pay_mode_from', pl.pay_mode_from),
          jsonb_build_object('pay_mode', mode, 'pay_mode_from', nf));
end $$;
revoke execute on function player_set_pay_mode(uuid, text, date) from public, anon;
grant execute on function player_set_pay_mode(uuid, text, date) to authenticated;

-- 6. Начисление визита по отметке посещаемости
create or replace function attendance_own_visit_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare sid uuid; pid uuid; pl players; ses sessions; present boolean; ov own_visits; club uuid;
begin
  if tg_op = 'DELETE' then sid := old.session_id; pid := old.player_id; present := false;
  else sid := new.session_id; pid := new.player_id; present := (new.status = 'present');
  end if;
  select * into pl from players where id = pid;
  if not found or pl.pay_mode <> 'per_visit' or pl.pay_mode_from is null then return null; end if;
  select * into ses from sessions where id = sid;
  if not found or tbilisi_day(ses.starts_at) < pl.pay_mode_from then return null; end if;
  if present then
    if not exists (select 1 from own_visits where session_id = sid and player_id = pid) then
      select g.club_id into club from groups g where g.id = ses.group_id;
      insert into own_visits (session_id, player_id, amount) values (sid, pid, own_visit_fee(club)) on conflict do nothing;
    end if;
  else
    select * into ov from own_visits where session_id = sid and player_id = pid for update;
    if found then
      if ov.paid then raise exception 'visit paid' using errcode = '22023'; end if;
      delete from own_visits where session_id = sid and player_id = pid;
    end if;
  end if;
  return null;
end $$;
revoke execute on function attendance_own_visit_sync() from public, anon, authenticated;
drop trigger if exists attendance_own_visit_sync on attendance;
create trigger attendance_own_visit_sync after insert or update of status or delete on attendance
  for each row execute function attendance_own_visit_sync();

-- 7. Оплата визита: принимает администратор или тренер, снимает только администратор (минус от исходной оплаты)
create or replace function own_visit_set_paid(s uuid, p uuid, is_paid boolean, mth text default null, amt numeric default null, d date default null) returns void
language plpgsql security definer set search_path = public as $$
declare g own_visits; orig service_payments; got numeric;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if coalesce(is_paid, false) then
    if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  else
    if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  select * into g from own_visits where session_id = s and player_id = p for update;
  if not found then raise exception 'visit not found' using errcode = 'P0002'; end if;
  if coalesce(is_paid, false) then
    if amt is not null and amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
    if g.paid then return; end if;
    perform service_method_ok(mth);
    got := coalesce(amt, g.amount);
    update own_visits set paid = true, paid_amount = got, method = trim(mth) where session_id = s and player_id = p;
    if got <> 0 then perform service_payment_add('own_visit', s, p, got, d, mth); end if;
  else
    if not g.paid then return; end if;
    orig := service_payment_original('own_visit', s, p);
    update own_visits set paid = false, paid_amount = null, method = null where session_id = s and player_id = p;
    if orig.id is not null then
      perform service_payment_add('own_visit', s, p, -orig.amount, d, orig.method, orig.id);
    end if;
  end if;
end $$;
revoke execute on function own_visit_set_paid(uuid, uuid, boolean, text, numeric, date) from public, anon;
grant execute on function own_visit_set_paid(uuid, uuid, boolean, text, numeric, date) to authenticated;

-- 8. Итог за месяц для карточки игрока: только факт, без сравнения «выгоды»; цена абонемента группы справочно
create or replace function player_visit_month(p uuid, m date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare mm date := date_trunc('month', m)::date; pl players; res jsonb;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach() or is_guardian_of(p) or is_self_player(p)) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into pl from players where id = p;
  if not found then raise exception 'player not found' using errcode = 'P0002'; end if;
  select jsonb_build_object(
           'month', mm,
           'visits', count(*),
           'accrued', coalesce(sum(v.amount), 0),
           'paid', coalesce(sum(case when v.paid then coalesce(v.paid_amount, v.amount) else 0 end), 0))
    into res
    from own_visits v join sessions s on s.id = v.session_id
   where v.player_id = p and date_trunc('month', tbilisi_day(s.starts_at))::date = mm;
  return res || jsonb_build_object('subscription_price', tariff_for(pl.club_id, pl.group_id, mm));
end $$;
revoke execute on function player_visit_month(uuid, date) from public, anon;
grant execute on function player_visit_month(uuid, date) to authenticated;

-- 9. Функции долга, кассы и календаря: тела из последних определений, изменено только перечисленное в шапке

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
    and not player_per_visit_month(c.pid, c.m)
    and (c.pd > 0 or not player_paused_month(c.pid, c.m))
  order by c.m desc, c.pid;
end $function$;

create or replace function subscription_month_auto(m date default null) returns int
language plpgsql security definer set search_path = public as $$
declare cur date := date_trunc('month', tbilisi_day(now()))::date; mm date := date_trunc('month', coalesce(m, tbilisi_day(now())))::date; n int;
begin
  if mm < debt_start() or mm > (cur + interval '1 month')::date then raise exception 'month out of range' using errcode = '22023'; end if;
  insert into subscriptions (player_id, group_id, month, amount_due)
  select pl.id, pl.group_id, mm, coalesce(tariff_for(pl.club_id, pl.group_id, mm), 0)
  from players pl join groups gr on gr.id = pl.group_id
  where pl.status = 'active' and lower(gr.name) <> 'индивидуальные / вратарские'
    and not player_per_visit_month(pl.id, mm)
  on conflict (player_id, month) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function subscription_month_missing(m date) returns int
language plpgsql stable security definer set search_path = public as $$
declare mm date := date_trunc('month', m)::date; cur date := date_trunc('month', tbilisi_day(now()))::date; n int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mm < debt_start() or mm > (cur + interval '1 month')::date then raise exception 'month out of range' using errcode = '22023'; end if;
  select count(*)::int into n
  from players pl join groups gr on gr.id = pl.group_id
  where pl.status = 'active' and lower(gr.name) <> 'индивидуальные / вратарские'
    and not player_per_visit_month(pl.id, mm)
    and not exists (select 1 from subscriptions s where s.player_id = pl.id and s.month = mm);
  return n;
end $$;

create or replace function parent_dues()
returns table(player_id uuid, kind text, title text, on_date date, due numeric, paid numeric, debt numeric)
language plpgsql stable security definer set search_path = public as $$
declare local_now timestamp := now() at time zone 'Asia/Tbilisi'; today date := (now() at time zone 'Asia/Tbilisi')::date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
  with kids as (
    select pl.id pid
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.user_id = current_user_id() and parent_access_ok(pg.user_id, pg.player_id)
    where pl.status = 'active'
      and exists (select 1 from club_settings cs where cs.club_id = pl.club_id and cs.key = 'parent_debt_enabled' and cs.value = 'true')
  )
  select o.player_id, 'eq'::text,
         case when o.status = 'cancelled' then 'Отменён: ' else '' end
           || coalesce((select string_agg(l.kit, ' + ' order by l.kit) from equipment_order_lines l where l.order_id = o.id), 'Экипировка'),
         o.ordered_on,
         case when o.status = 'cancelled' then 0 else o.total end,
         o.paid,
         case when o.status = 'cancelled' then 0 else greatest(o.total - o.paid, 0) end
  from equipment_orders o join kids k on k.pid = o.player_id
  where o.status <> 'cancelled' or o.paid > 0
  union all
  select b.player_id, 'ind'::text, case when s.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end,
         s.starts_at::date, b.amount, case when b.paid then b.amount else 0 end, case when b.paid then 0 else b.amount end
  from individual_bookings b join individual_sessions s on s.id = b.session_id join kids k on k.pid = b.player_id
  where s.starts_at < local_now
  union all
  select b.player_id, 'extra'::text, 'Дополнительная тренировка' || coalesce(', ' || s.place, ''),
         s.starts_on, s.amount, case when b.paid then coalesce(b.paid_amount, s.amount) else 0 end,
         case when b.paid then greatest(s.amount - coalesce(b.paid_amount, s.amount), 0) else s.amount end
  from extra_bookings b join extra_sessions s on s.id = b.session_id join kids k on k.pid = b.player_id
  where s.starts_on <= today and s.cancelled_at is null
  union all
  select g.player_id, 'visit'::text, 'Доп. посещение: ' || gr.name, tbilisi_day(s.starts_at), g.amount,
         case when g.paid then coalesce(g.paid_amount, g.amount) else 0 end,
         case when g.paid then greatest(g.amount - coalesce(g.paid_amount, g.amount), 0) else g.amount end
  from session_guests g join sessions s on s.id = g.session_id join groups gr on gr.id = s.group_id join kids k on k.pid = g.player_id
  where tbilisi_day(s.starts_at) <= today
  union all
  select g.player_id, 'own_visit'::text, 'Оплата за визит: ' || gr.name, tbilisi_day(s.starts_at), g.amount,
         case when g.paid then coalesce(g.paid_amount, g.amount) else 0 end,
         case when g.paid then greatest(g.amount - coalesce(g.paid_amount, g.amount), 0) else g.amount end
  from own_visits g join sessions s on s.id = g.session_id join groups gr on gr.id = s.group_id join kids k on k.pid = g.player_id
  where tbilisi_day(s.starts_at) <= today
  union all
  select cp.player_id, 'camp'::text, c.name, c.starts_on, cp.amount, coalesce(pm.amt, 0), greatest(cp.amount - coalesce(pm.amt, 0), 0)
  from camp_participants cp join camps c on c.id = cp.camp_id join kids k on k.pid = cp.player_id
  left join lateral (select sum(x.amount) amt from camp_payments x where x.participant_id = cp.id) pm on true
  where cp.status = 'registered'
  order by 4 desc;
end $$;

CREATE OR REPLACE FUNCTION public.cash_report(p_from date, p_to date, p_location text DEFAULT NULL::text, p_staff uuid DEFAULT NULL::uuid, p_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare res jsonb;
begin
  if not is_admin() and not has_location_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad period' using errcode = '22023'; end if;

  with src as (
    select 'Абонемент' as kind, p.id, p.player_id, p.amount, p.paid_on, p.method, p.recorded_by, p.recorded_at, gr.location as location
      from payments p join players pl on pl.id = p.player_id left join groups gr on gr.id = pl.group_id
    union all
    select 'Сбор', c.id, c.player_id, c.amount, c.paid_on, c.method, c.recorded_by, c.recorded_at, cm.location
      from camp_payments c left join camps cm on cm.id = c.camp_id
    union all
    select 'Взнос матча', m.id, m.player_id, m.amount, m.paid_on, m.method, m.recorded_by, m.recorded_at, null
      from match_payments m
    union all
    select 'Взнос события', t.id, t.player_id, t.amount, t.paid_on, t.method, t.recorded_by, t.recorded_at, null
      from tournament_payments t
    union all
    select case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' when 'visit' then 'Доп. посещение' when 'own_visit' then 'Оплата за визит' else 'Доп. занятие' end,
           sp.id, sp.player_id, sp.amount, sp.paid_on, sp.method, sp.recorded_by, sp.recorded_at,
           case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                        when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id)
                        when 'visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id)
                        when 'own_visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id) end
      from service_payments sp
     where sp.op <> 'opening_balance' -- 0188: остатки до начала учёта не деньги периода
  ), rows_f as (
    select s.*, case when s.method in ('Наличные', 'Перевод') then s.method else 'не указан' end as method_key
      from src s
     where s.paid_on between p_from and p_to
       and (p_location is null or s.location = p_location)
       and (p_staff is null or s.recorded_by = p_staff)
       and (is_admin() or (s.recorded_by = current_user_id()
                           and s.location in (select la.location from location_admins la where la.user_id = current_user_id())))
  ), rows_m as (
    select * from rows_f where p_method is null or method_key = p_method
  )
  select jsonb_build_object(
    'total', coalesce((select sum(amount) from rows_m), 0),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method_key, 'sum', sm) order by method_key)
                             from (select method_key, sum(amount) sm from rows_m group by method_key) x), '[]'::jsonb),
    'by_staff', coalesce((select jsonb_agg(jsonb_build_object('staff_id', staff_id, 'name', staff_name, 'sum', sm) order by staff_name)
                            from (select r.recorded_by as staff_id, coalesce(u.display_name, 'не указан') as staff_name, sum(r.amount) sm
                                    from rows_m r left join users u on u.id = r.recorded_by
                                   group by r.recorded_by, u.display_name) x), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', r.id, 'kind', r.kind, 'player', pl.full_name, 'amount', r.amount, 'paid_on', r.paid_on,
                        'method', r.method_key, 'staff', coalesce(u.display_name, 'не указан'), 'recorded_at', r.recorded_at,
                        'location', r.location)
                       order by r.paid_on, r.recorded_at nulls last, r.id)
                     from rows_m r join players pl on pl.id = r.player_id left join users u on u.id = r.recorded_by), '[]'::jsonb)
  ) into res;
  return res;
end $function$;

CREATE OR REPLACE FUNCTION public.cash_day_service(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() and not has_location_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'method', x.method, 'what', x.what,
                                        'player_id', x.player_id, 'full_name', x.full_name, 'recorded_at', x.recorded_at,
                                        'detail', x.detail)
                     order by x.recorded_at nulls last, x.id)
      from (
        select sp.id, sp.amount, sp.method, sp.player_id, pl.full_name, sp.recorded_at,
               case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' when 'visit' then 'Доп. посещение' when 'own_visit' then 'Оплата за визит' else 'Доп. занятие' end as what,
               case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                            when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id)
                            when 'visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id)
                        when 'own_visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id) end as loc,
               null::text as detail
          from service_payments sp join players pl on pl.id = sp.player_id
         where sp.paid_on = p_day and sp.op <> 'opening_balance' -- 0188: остатки до начала учёта не деньги дня
        union all
        select mp.id, mp.amount, mp.method, mp.player_id, pl.full_name, mp.recorded_at,
               'Взнос матча', null::text,
               concat_ws(' ', to_char(m.played_on, 'DD.MM'), nullif(m.opponent, ''))
          from match_payments mp join players pl on pl.id = mp.player_id join matches m on m.id = mp.match_id
         where mp.paid_on = p_day
        union all
        select tp.id, tp.amount, tp.method, tp.player_id, pl.full_name, tp.recorded_at,
               'Взнос события', null::text, t.name
          from tournament_payments tp join players pl on pl.id = tp.player_id join tournaments t on t.id = tp.tournament_id
         where tp.paid_on = p_day
      ) x
     where is_admin() or x.loc in (select la.location from location_admins la where la.user_id = current_user_id())
  ), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.parent_calendar(p_player uuid, p_from date, p_to date)
 RETURNS TABLE(event_id text, event_date date, event_time time without time zone, event_type text, title text, location text, event_status text, attendance_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := current_user_id();
  player_group uuid;
  player_group_name text;
  player_club uuid;
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_player is null or p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 180 then raise exception 'date range too large' using errcode = '22023'; end if;
  if not exists (
    select 1 from player_guardians pg
    where pg.player_id = p_player and pg.user_id = me and parent_access_ok(pg.user_id, pg.player_id)
  ) then raise exception 'forbidden' using errcode = '42501'; end if;

  select pl.group_id, gr.name, pl.club_id into player_group, player_group_name, player_club
  from players pl left join groups gr on gr.id = pl.group_id where pl.id = p_player;

  return query
  select e.event_id, e.event_date, e.event_time, e.event_type, e.title, e.location, e.event_status, e.attendance_status
  from (
    select
      ('match:' || m.id::text)::text as event_id, m.played_on as event_date, null::time as event_time, 'match'::text as event_type,
      coalesce(nullif(trim(m.opponent), ''), 'Матч')::text as title, null::text as location,
      case when m.goals_for is not null and m.goals_against is not null then 'completed'
           when m.played_on < (now() at time zone 'Asia/Tbilisi')::date then 'past'
           else 'upcoming' end::text as event_status,
      case when mp.played then 'played' when mp.match_id is not null then 'not_played' else null end::text as attendance_status
    from matches m
    left join match_players mp on mp.match_id = m.id and mp.player_id = p_player
    where m.played_on between p_from and p_to
      and m.lifecycle_status in ('legacy', 'published')
      and (
        (player_group is not null and (
          m.team = player_group_name
          or (right(player_group_name, 2) in ('-A', '-B', '-C') and left(player_group_name, length(player_group_name) - 2) = m.team)
        ))
        or mp.player_id is not null
      )

    union all

    select * from (
    select distinct on (tl.held_on, tl.starts_at, tl.kind)
      ('training-log:' || tl.id::text)::text, tl.held_on, tl.starts_at, 'training'::text,
      case tl.kind when 'Вратарская' then 'Вратарская тренировка'
        when 'Индивидуальная' then 'Индивидуальная тренировка' else 'Тренировка' end::text,
      tl.location::text, 'past'::text, null::text
    from training_log tl
    where tl.club_id = player_club
      and tl.group_label = (select gh.name from groups gh where gh.id = points_group_at(p_player, tl.held_on))
      and tl.held and tl.held_on between p_from and p_to
      and not exists (
        select 1 from sessions s
        where s.group_id = points_group_at(p_player, tl.held_on)
          and (s.starts_at at time zone 'Asia/Tbilisi')::date = tl.held_on
      )
    order by tl.held_on, tl.starts_at, tl.kind, tl.id
    ) tlr

    union all

    select
      ('session:' || s.id::text)::text, (s.starts_at at time zone 'Asia/Tbilisi')::date,
      (s.starts_at at time zone 'Asia/Tbilisi')::time, 'training'::text,
      case when s.kind = 'training' then 'Групповая тренировка' else 'Тренировка' end::text,
      gr.location::text,
      case when (s.starts_at at time zone 'Asia/Tbilisi')::date < (now() at time zone 'Asia/Tbilisi')::date
        then 'past' else 'upcoming' end::text,
      a.status::text
    from sessions s
    join groups gr on gr.id = s.group_id
    left join attendance a on a.session_id = s.id and a.player_id = p_player
    where (s.group_id = points_group_at(p_player, tbilisi_day(s.starts_at)) or a.player_id is not null)
      and (s.starts_at at time zone 'Asia/Tbilisi')::date between p_from and p_to

    union all

    -- Индивидуальные/вратарские занятия включаем только при активной записи именно этого ребёнка.
    select
      ('individual:' || ind.id::text)::text,
      ind.starts_at::date,
      ind.starts_at::time,
      'training'::text,
      (case when ind.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end
        || case when nullif(trim(ind.topic), '') is not null then ': ' || trim(ind.topic) else '' end)::text,
      null::text,
      case when ind.starts_at::date < (now() at time zone 'Asia/Tbilisi')::date then 'past' else 'upcoming' end::text,
      case when ib.attended then 'present' when ib.attended is false then 'absent' else null end::text
    from individual_sessions ind
    join individual_bookings ib on ib.session_id = ind.id and ib.player_id = p_player
    where ind.club_id = player_club
      and ind.starts_at::date between p_from and p_to

    union all

    -- Дополнительные занятия тоже доступны только если ребёнок записан на них.
    select
      ('extra:' || ex.id::text)::text,
      ex.starts_on,
      null::time,
      'training'::text,
      'Дополнительная тренировка'::text,
      ex.place::text,
      case when ex.starts_on < (now() at time zone 'Asia/Tbilisi')::date then 'past' else 'upcoming' end::text,
      case when eb.attended then 'present' when eb.attended is false then 'absent' else null end::text
    from extra_sessions ex
    join extra_bookings eb on eb.session_id = ex.id and eb.player_id = p_player
    where ex.club_id = player_club
      and ex.cancelled_at is null
      and ex.starts_on between p_from and p_to

    union all

    -- Разовое посещение тренировки другой группы (0178): только сам гость; родители группы-хозяина его не видят
    select
      ('guest:' || gs.id::text)::text,
      tbilisi_day(gs.starts_at),
      (gs.starts_at at time zone 'Asia/Tbilisi')::time,
      'training'::text,
      ('Доп. посещение: ' || gg.name)::text,
      gg.location::text,
      case when tbilisi_day(gs.starts_at) < (now() at time zone 'Asia/Tbilisi')::date then 'past' else 'upcoming' end::text,
      'present'::text
    from session_guests sg
    join sessions gs on gs.id = sg.session_id
    join groups gg on gg.id = gs.group_id
    where sg.player_id = p_player
      and tbilisi_day(gs.starts_at) between p_from and p_to

    union all

    select
      ('schedule:' || ws.id::text || ':' || cal.day::date::text)::text,
      cal.day::date, ws.starts_at, 'training'::text,
      case ws.kind when 'Вратарская' then 'Вратарская тренировка'
        when 'Индивидуальная' then 'Индивидуальная тренировка' else 'Тренировка по расписанию' end::text,
      coalesce(ws.location, gr.location)::text, 'upcoming'::text, null::text
    from weekly_schedule ws
    join groups gr on gr.id = ws.group_id
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') cal(day)
    where player_group is not null and ws.group_id = player_group
      and extract(isodow from cal.day)::int = ws.weekday
      and cal.day::date >= (now() at time zone 'Asia/Tbilisi')::date
      and not exists (
        select 1 from sessions s
        where s.group_id = ws.group_id
          and (s.starts_at at time zone 'Asia/Tbilisi')::date = cal.day::date
          and (s.starts_at at time zone 'Asia/Tbilisi')::time = ws.starts_at
      )
      and not exists (
        select 1 from training_log tl where tl.club_id = gr.club_id
          and tl.group_label = player_group_name and tl.held and tl.held_on = cal.day::date
      )
  ) e
  order by e.event_date, e.event_time nulls last, e.event_type, e.event_id;
end;
$function$;

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
    select tbilisi_day(s.starts_at), (s.starts_at at time zone 'Asia/Tbilisi')::time, 'guest', ('Доп. посещение: ' || gr.name)::text, gr.name::text, 'present'
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

commit;
