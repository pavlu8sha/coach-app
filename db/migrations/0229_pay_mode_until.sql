-- 0229: возврат на абонемент с датой, период «за визит» (players.pay_mode_until). Условия: docs/PAY_MODE_RETURN_AND_NEXT_MONTH_ACCEPTANCE.md, часть A.
-- Случай 2026-11-27: Fedorov Lev/Matvey, per_visit с 01.11, возврат с 01.12; прежний возврат обнулял pay_mode_from, и ноябрь снова считался абонементным.
-- Изменено: колонка pay_mode_until и ограничение периода; player_per_visit_month (период), player_per_visit_day (новая, служебная); player_set_pay_mode (возврат принимает дату, по умолчанию 1-е следующего месяца);
-- own_visits_backfill, attendance_own_visit_sync (визиты только за месяцы «за визит»); session_guest_add (цена гостя по периоду, 0201); player_visit_month (доп. посещения по периоду, 0206).
-- Тела взяты из последних определений: 0228 (backfill, sync, set_pay_mode), 0201 (session_guest_add), 0206 (player_visit_month), 0200 (player_per_visit_month); grep -lEi "function +(public\.)?имя *\(" db/migrations/*.sql.
-- Откат: db/ops/rollback-0229-pay-mode-until.sql. Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

alter table players add column if not exists pay_mode_until date;
alter table players drop constraint if exists players_pay_mode_from_check;
alter table players drop constraint if exists players_pay_period_check;
alter table players add constraint players_pay_period_check check (
  (pay_mode = 'per_visit' and pay_mode_from is not null and pay_mode_until is null)
  or (pay_mode = 'subscription' and ((pay_mode_from is null and pay_mode_until is null)
       or (pay_mode_from is not null and pay_mode_until is not null and pay_mode_until > pay_mode_from))));

-- Месяц «за визит»: с месяца pay_mode_from и до месяца возврата (не включая); без возврата пока режим per_visit
create or replace function player_per_visit_month(pid uuid, m date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players p where p.id = pid and p.pay_mode_from is not null
                   and date_trunc('month', p.pay_mode_from)::date <= date_trunc('month', m)::date
                   and ((p.pay_mode = 'per_visit' and p.pay_mode_until is null)
                        or (p.pay_mode_until is not null and date_trunc('month', m)::date < date_trunc('month', p.pay_mode_until)::date)))
$$;
revoke execute on function player_per_visit_month(uuid, date) from public, anon, authenticated;

-- День «за визит»: день не раньше pay_mode_from и его месяц «за визит»
create or replace function player_per_visit_day(pid uuid, d date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players p where p.id = pid and p.pay_mode_from is not null and d >= p.pay_mode_from)
         and player_per_visit_month(pid, date_trunc('month', d)::date)
$$;
revoke execute on function player_per_visit_day(uuid, date) from public, anon, authenticated;

create or replace function own_visits_backfill(p uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl players; n int;
begin
  select * into pl from players where id = p for update;
  if not found or pl.pay_mode_from is null then return 0; end if;
  insert into own_visits (session_id, player_id, amount)
    select s.id, pl.id, own_visit_fee(g.club_id)
      from attendance a
      join sessions s on s.id = a.session_id
      join groups g on g.id = s.group_id
     where a.player_id = pl.id and a.status = 'present'
       and s.kind = 'training' and lower(g.name) <> 'индивидуальные / вратарские' and g.club_id = pl.club_id
       and tbilisi_day(s.starts_at) >= pl.pay_mode_from and tbilisi_day(s.starts_at) <= tbilisi_day(now())
       and player_per_visit_month(pl.id, date_trunc('month', tbilisi_day(s.starts_at))::date)
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function own_visits_backfill(uuid) from public, anon, authenticated;

create or replace function attendance_own_visit_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid; pid uuid; pl players; ses sessions; present boolean; ov own_visits; club uuid; gname text;
begin
  if tg_op = 'DELETE' then sid := old.session_id; pid := old.player_id; present := false;
  else sid := new.session_id; pid := new.player_id; present := (new.status = 'present');
  end if;
  select * into pl from players where id = pid for share;
  if not found or pl.pay_mode_from is null then return null; end if;
  select * into ses from sessions where id = sid;
  if not found or not player_per_visit_day(pid, tbilisi_day(ses.starts_at)) then return null; end if;
  select g.club_id, lower(g.name) into club, gname from groups g where g.id = ses.group_id;
  -- граница только на создание визита; неоплаченный визит за такое занятие (если остался с 0200/0213) при снятии отметки удаляется как раньше
  if present and (ses.kind <> 'training' or club is distinct from pl.club_id or gname = 'индивидуальные / вратарские') then return null; end if;
  if present then
    if not exists (select 1 from own_visits where session_id = sid and player_id = pid) then
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

create or replace function player_set_pay_mode(p uuid, mode text, from_d date default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl players; nf date; nu date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mode is null or mode not in ('subscription', 'per_visit') then raise exception 'bad pay mode' using errcode = '22023'; end if;
  select * into pl from players where id = p for update;
  if not found then raise exception 'player not found' using errcode = 'P0002'; end if;
  if pl.club_id is distinct from club_event_current_club() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mode = 'per_visit' then
    nf := coalesce(from_d, tbilisi_day(now()));
    if nf > tbilisi_day(now()) then raise exception 'date in the future' using errcode = '22023'; end if;
    nu := null;
  elsif pl.pay_mode_from is null then
    nf := null; nu := null;
  elsif pl.pay_mode = 'subscription' and pl.pay_mode_until is not null and from_d is null then
    return;
  else
    nu := coalesce(from_d, (date_trunc('month', tbilisi_day(now())) + interval '1 month')::date);
    if nu <= pl.pay_mode_from then nf := null; nu := null; else nf := pl.pay_mode_from; end if;
  end if;
  if pl.pay_mode = mode and pl.pay_mode_from is not distinct from nf and pl.pay_mode_until is not distinct from nu then
    if mode = 'per_visit' then perform own_visits_backfill(p); end if;
    return;
  end if;
  update players set pay_mode = mode, pay_mode_from = nf, pay_mode_until = nu where id = p;
  insert into audit_log (actor_id, action, entity, entity_id, before, after)
  values (current_user_id(), 'player_pay_mode', 'players', p,
          jsonb_build_object('pay_mode', pl.pay_mode, 'pay_mode_from', pl.pay_mode_from, 'pay_mode_until', pl.pay_mode_until),
          jsonb_build_object('pay_mode', mode, 'pay_mode_from', nf, 'pay_mode_until', nu));
  if mode = 'per_visit' then perform own_visits_backfill(p); end if;
end $$;
revoke execute on function player_set_pay_mode(uuid, text, date) from public, anon;
grant execute on function player_set_pay_mode(uuid, text, date) to authenticated;

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
  -- 0201: игрок «Платит за визит» (на день занятия) платит за гостевое посещение own_visit.fee (20), остальные visit.fee (15)
  insert into session_guests (session_id, player_id, amount, added_by)
    values (s, p,
            case when player_per_visit_day(p, tbilisi_day(ses.starts_at))
                 then own_visit_fee(club) else guest_visit_fee(club) end,
            current_user_id())
    on conflict (session_id, player_id) do nothing;
end $$;

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
           'guest_visits', count(*) filter (where v.guest),
           'accrued', coalesce(sum(v.amount), 0),
           'paid', coalesce(sum(case when v.paid then coalesce(v.paid_amount, v.amount) else 0 end), 0))
    into res
    from (
      select ov.amount, ov.paid, ov.paid_amount, false as guest
        from own_visits ov join sessions s on s.id = ov.session_id
       where ov.player_id = p and date_trunc('month', tbilisi_day(s.starts_at))::date = mm
      union all
      select sg.amount, sg.paid, sg.paid_amount, true
        from session_guests sg join sessions s on s.id = sg.session_id
       where sg.player_id = p and player_per_visit_day(p, tbilisi_day(s.starts_at))
         and date_trunc('month', tbilisi_day(s.starts_at))::date = mm
    ) v;
  return res || jsonb_build_object('subscription_price', tariff_for(pl.club_id, pl.group_id, mm));
end $$;

commit;
