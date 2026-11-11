-- 0177: разовые посещения тренировок другой группы (учёт посещения, оплата, баллы). Условия приёмки: docs/GUEST_VISIT_ACCEPTANCE.md.
-- Решения владельца 2026-11-11: 15 ₾ за посещение, баллы как за обычную тренировку, показывать родителю.
--  * session_guests: игрок другой группы на занятии группы. Это не attendance: отметки группы, проверка «отмечены все», статистика и серии не меняются.
--  * session_guest_add / session_guest_remove / session_guest_set_paid: админ и тренер добавляют, убирают гостя и принимают оплату; снимает оплату только админ.
--  * Сумма посещения: настройка клуба visit.fee (по умолчанию 15), фиксируется при добавлении. Оплата идёт в service_payments (вид visit) и не трогает payments, subscriptions и долг.
--  * Баллы: points_reconcile_group_session учитывает гостей (те же правила, что за «Был» на занятии; группа в журнале — собственная группа игрока).
--  * Родитель: parent_calendar и parent_dues показывают разовое посещение гостя. Касса: cash_report и cash_day_service знают вид visit.
-- Тела пересозданных функций взяты из последних определений (0110, 0121, 0156, 0173) и изменены только перечисленным выше (урок 2026-11-11): перед применением
-- обновить ветку с master и пересобрать тела, если эти функции менялись после 0173. Не применять до 0173 и 0175.
-- Откат: drop trigger points_session_guests_sync on session_guests; drop table session_guests cascade; удалить настройку visit.fee; вернуть функции из 0110, 0121, 0156, 0173;
-- строки service_payments вида visit не удалять (журнал только добавляется), констрейнт вида оставить.
-- Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

-- 1. Таблица гостей
create table session_guests (
  session_id uuid not null references sessions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  paid boolean not null default false,
  paid_amount numeric(10,2) check (paid_amount is null or paid_amount >= 0),
  method text check (method is null or method in ('Наличные', 'Перевод')),
  added_by uuid references users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (session_id, player_id)
);
create index session_guests_player on session_guests (player_id);
alter table session_guests enable row level security;
revoke all on session_guests from public, anon, authenticated;
grant select on session_guests to authenticated;
grant all on session_guests to service_role;
create policy session_guests_read on session_guests for select
  using (is_admin() or is_any_coach() or is_guardian_of(player_id) or is_self_player(player_id));

-- 2. Новый вид оплаты в журнале
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'service_payments'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%equipment%individual%extra%';
  if c is not null then execute format('alter table service_payments drop constraint %I', c); end if;
end $$;
alter table service_payments add constraint service_payments_kind_check check (kind in ('equipment', 'individual', 'extra', 'visit'));

-- 3. Сумма посещения: настройка visit.fee, пустая — 15; недопустимое значение не подменяем молча
create or replace function guest_visit_fee(c uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v text; n numeric;
begin
  select nullif(trim(value), '') into v from club_settings where club_id = c and key = 'visit.fee';
  if v is null then return 15; end if;
  begin
    n := replace(v, ',', '.')::numeric;
  exception when others then
    n := null;
  end;
  if n is null or n = 'NaN'::numeric or n < 0 or n > 10000 then raise exception 'invalid setting visit.fee: %', v using errcode = '22023'; end if;
  return round(n, 2);
end $$;
revoke execute on function guest_visit_fee(uuid) from public, anon, authenticated;

-- 4. Функции: добавить, убрать, оплата
create or replace function session_guest_add(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses sessions; pl players; club uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ses from sessions where id = s;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  select * into pl from players where id = p;
  if not found then raise exception 'player not found' using errcode = 'P0002'; end if;
  select g.club_id into club from groups g where g.id = ses.group_id;
  if pl.club_id is distinct from club then raise exception 'player not found' using errcode = 'P0002'; end if;
  if tbilisi_day(ses.starts_at) > tbilisi_day(now()) then raise exception 'date in the future' using errcode = '22023'; end if;
  if pl.group_id is not distinct from ses.group_id then raise exception 'same group' using errcode = '22023'; end if;
  if pl.status <> 'active' then raise exception 'player not active' using errcode = '22023'; end if;
  insert into session_guests (session_id, player_id, amount, added_by)
    values (s, p, guest_visit_fee(club), current_user_id())
    on conflict (session_id, player_id) do nothing;
end $$;
revoke execute on function session_guest_add(uuid, uuid) from public, anon;
grant execute on function session_guest_add(uuid, uuid) to authenticated;

create or replace function session_guest_remove(s uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g session_guests;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into g from session_guests where session_id = s and player_id = p for update;
  if not found then return; end if;
  if g.paid then raise exception 'visit paid' using errcode = '22023'; end if;
  delete from session_guests where session_id = s and player_id = p;
end $$;
revoke execute on function session_guest_remove(uuid, uuid) from public, anon;
grant execute on function session_guest_remove(uuid, uuid) to authenticated;

-- Оплата принимается админом или тренером; отмена оплаты (минус от исходной оплаты) только админом
create or replace function session_guest_set_paid(s uuid, p uuid, is_paid boolean, mth text default null, amt numeric default null, d date default null) returns void
language plpgsql security definer set search_path = public as $$
declare g session_guests; orig service_payments; got numeric;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if coalesce(is_paid, false) then
    if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  else
    if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  select * into g from session_guests where session_id = s and player_id = p for update;
  if not found then raise exception 'guest not found' using errcode = 'P0002'; end if;
  if coalesce(is_paid, false) then
    if amt is not null and amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
    if g.paid then return; end if;
    perform service_method_ok(mth);
    got := coalesce(amt, g.amount);
    update session_guests set paid = true, paid_amount = got, method = trim(mth) where session_id = s and player_id = p;
    if got <> 0 then perform service_payment_add('visit', s, p, got, d, mth); end if;
  else
    if not g.paid then return; end if;
    orig := service_payment_original('visit', s, p);
    update session_guests set paid = false, paid_amount = null, method = null where session_id = s and player_id = p;
    if orig.id is not null then
      perform service_payment_add('visit', s, p, -orig.amount, d, orig.method, orig.id);
    end if;
  end if;
end $$;
revoke execute on function session_guest_set_paid(uuid, uuid, boolean, text, numeric, date) from public, anon;
grant execute on function session_guest_set_paid(uuid, uuid, boolean, text, numeric, date) to authenticated;

-- Баллы пересчитываются при добавлении и удалении гостя (смена класса или времени занятия уже вызывает пересчёт)
create or replace function points_trg_session_guest() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform points_reconcile_group_session(case when tg_op = 'DELETE' then old.session_id else new.session_id end);
  return null;
end $$;
revoke execute on function points_trg_session_guest() from public, anon, authenticated;
create trigger points_session_guests_sync after insert or delete on session_guests
  for each row execute function points_trg_session_guest();

-- 5. Баллы: тело points_reconcile_group_session из 0121 + гости (изменён только расчёт ожидаемого набора)
create or replace function points_reconcile_group_session(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s sessions; club uuid; day date; rv points_rule_versions; pts int; exp jsonb := '[]'::jsonb;
begin
  select * into s from sessions where id = sid;
  if s.id is null then
    select l.club_id into club from points_ledger l where l.source_type = 'group_session' and l.source_id = sid limit 1;
    if club is not null then perform points_ledger_apply(club, 'group_session', sid, '[]'::jsonb, 'source_deleted'); end if;
    return;
  end if;
  select g.club_id into club from groups g where g.id = s.group_id;
  day := tbilisi_day(s.starts_at);
  rv := points_rules_for(club, day);
  if rv.id is not null and coalesce((rv.params #>> '{enabled,training}')::boolean, false) then
    pts := case s.class when 'regular' then (rv.params #>> '{training,group}')::int
                        when 'moved' then (rv.params #>> '{training,moved_group}')::int
                        else (rv.params #>> '{training,extra}')::int end;
    if pts > 0 then
      select coalesce(jsonb_agg(x.e), '[]'::jsonb) into exp from (
        select jsonb_build_object('player_id', a.player_id, 'group_id', s.group_id, 'event_date', day, 'reason_code', 'attended',
               'points', pts, 'components', jsonb_build_object('class', s.class, 'base', pts), 'rule_version_id', rv.id) as e
          from attendance a where a.session_id = sid and a.status = 'present'
        union all
        -- разовое посещение (0177): баллы идут в собственную группу игрока на дату занятия; тот же игрок не считается дважды
        select jsonb_build_object('player_id', g.player_id, 'group_id', points_group_at(g.player_id, day), 'event_date', day, 'reason_code', 'attended',
               'points', pts, 'components', jsonb_build_object('class', s.class, 'base', pts, 'guest', true), 'rule_version_id', rv.id)
          from session_guests g
         where g.session_id = sid
           and not exists (select 1 from attendance a2 where a2.session_id = sid and a2.player_id = g.player_id and a2.status = 'present')
      ) x;
    end if;
  end if;
  perform points_ledger_apply(club, 'group_session', sid, exp, 'attendance_changed');
end $$;

-- 6. Календарь и оплаты родителя: тела из 0173 + строки разовых посещений
-- parent_calendar(uuid,date,date)
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
    where player_group is not null and tl.club_id = player_club
      and tl.group_label = player_group_name and tl.held and tl.held_on between p_from and p_to
      and not exists (
        select 1 from sessions s
        where s.group_id = player_group
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
    where player_group is not null and s.group_id = player_group
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

    -- Разовое посещение тренировки другой группы (0177): только сам гость; родители группы-хозяина его не видят
    select
      ('guest:' || gs.id::text)::text,
      tbilisi_day(gs.starts_at),
      (gs.starts_at at time zone 'Asia/Tbilisi')::time,
      'training'::text,
      ('Разовое посещение: ' || gg.name)::text,
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

-- parent_dues()
CREATE OR REPLACE FUNCTION public.parent_dues()
 RETURNS TABLE(player_id uuid, kind text, title text, on_date date, due numeric, paid numeric, debt numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         coalesce((select string_agg(l.kit, ' + ' order by l.kit) from equipment_order_lines l where l.order_id = o.id), 'Экипировка'),
         o.ordered_on, o.total, o.paid, greatest(o.total - o.paid, 0)
  from equipment_orders o join kids k on k.pid = o.player_id
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
  select g.player_id, 'visit'::text, 'Разовое посещение: ' || gr.name, tbilisi_day(s.starts_at), g.amount,
         case when g.paid then coalesce(g.paid_amount, g.amount) else 0 end,
         case when g.paid then greatest(g.amount - coalesce(g.paid_amount, g.amount), 0) else g.amount end
  from session_guests g join sessions s on s.id = g.session_id join groups gr on gr.id = s.group_id join kids k on k.pid = g.player_id
  where tbilisi_day(s.starts_at) <= today
  union all
  select cp.player_id, 'camp'::text, c.name, c.starts_on, cp.amount, coalesce(pm.amt, 0), greatest(cp.amount - coalesce(pm.amt, 0), 0)
  from camp_participants cp join camps c on c.id = cp.camp_id join kids k on k.pid = cp.player_id
  left join lateral (select sum(x.amount) amt from camp_payments x where x.participant_id = cp.id) pm on true
  where cp.status = 'registered'
  order by 4 desc;
end $function$;

-- 7. Касса: тела cash_report (0110) и cash_day_service (0156) + вид visit
create or replace function cash_report(
  p_from date, p_to date,
  p_location text default null, p_staff uuid default null, p_method text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
    select case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' when 'visit' then 'Разовое посещение' else 'Доп. занятие' end,
           sp.id, sp.player_id, sp.amount, sp.paid_on, sp.method, sp.recorded_by, sp.recorded_at,
           case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                        when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id)
                        when 'visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id) end
      from service_payments sp
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
end $$;

create or replace function cash_day_service(p_day date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() and not has_location_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'method', x.method, 'what', x.what,
                                        'player_id', x.player_id, 'full_name', x.full_name, 'recorded_at', x.recorded_at,
                                        'detail', x.detail)
                     order by x.recorded_at nulls last, x.id)
      from (
        select sp.id, sp.amount, sp.method, sp.player_id, pl.full_name, sp.recorded_at,
               case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' when 'visit' then 'Разовое посещение' else 'Доп. занятие' end as what,
               case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                            when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id)
                            when 'visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id) end as loc,
               null::text as detail
          from service_payments sp join players pl on pl.id = sp.player_id
         where sp.paid_on = p_day
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
end $$;

revoke execute on function cash_day_service(date) from public, anon;
grant execute on function cash_day_service(date) to authenticated;

commit;
