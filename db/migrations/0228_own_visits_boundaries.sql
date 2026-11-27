-- 0228: границы дозаполнения визитов за плату и клуб (Issue #726). Условия приёмки: docs/PAY_PER_VISIT_BACKFILL_HARDENING_ACCEPTANCE.md.
-- Основа #726 сделана в 0213. Здесь только: (1) own_visits_backfill и триггер attendance_own_visit_sync создают визит лишь за занятия kind = 'training'
-- группы клуба игрока, не являющейся служебной «Индивидуальные / вратарские»; (2) player_set_pay_mode отказывает (42501), если клуб игрока не совпадает с клубом администратора (club_event_current_club()).
-- Тела own_visits_backfill, attendance_own_visit_sync, player_set_pay_mode взяты из 0213 (последние определения: grep -lEi "function +(public\.)?имя *\(" db/migrations/*.sql даёт 0200 и 0213), блокировки и остальная логика не менялись.
-- Атомарность обеспечена самой функцией (одна транзакция); отдельного production backfill не требуется. Откат: db/ops/rollback-0228-own-visits-boundaries.sql.
create or replace function own_visits_backfill(p uuid) returns int
language plpgsql security definer set search_path = public as $$
declare pl players; n int;
begin
  select * into pl from players where id = p for update;
  if not found or pl.pay_mode <> 'per_visit' or pl.pay_mode_from is null then return 0; end if;
  insert into own_visits (session_id, player_id, amount)
    select s.id, pl.id, own_visit_fee(g.club_id)
      from attendance a
      join sessions s on s.id = a.session_id
      join groups g on g.id = s.group_id
     where a.player_id = pl.id and a.status = 'present'
       and s.kind = 'training' and lower(g.name) <> 'индивидуальные / вратарские' and g.club_id = pl.club_id
       and tbilisi_day(s.starts_at) >= pl.pay_mode_from and tbilisi_day(s.starts_at) <= tbilisi_day(now())
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function own_visits_backfill(uuid) from public, anon, authenticated;

create or replace function attendance_own_visit_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare sid uuid; pid uuid; pl players; ses sessions; present boolean; ov own_visits; club uuid; gname text;
begin
  if tg_op = 'DELETE' then sid := old.session_id; pid := old.player_id; present := false;
  else sid := new.session_id; pid := new.player_id; present := (new.status = 'present');
  end if;
  select * into pl from players where id = pid for share;
  if not found or pl.pay_mode <> 'per_visit' or pl.pay_mode_from is null then return null; end if;
  select * into ses from sessions where id = sid;
  if not found or tbilisi_day(ses.starts_at) < pl.pay_mode_from then return null; end if;
  if ses.kind <> 'training' then return null; end if;
  select g.club_id, lower(g.name) into club, gname from groups g where g.id = ses.group_id;
  if club is distinct from pl.club_id or gname = 'индивидуальные / вратарские' then return null; end if;
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
language plpgsql security definer set search_path = public as $$
declare pl players; nf date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if mode is null or mode not in ('subscription', 'per_visit') then raise exception 'bad pay mode' using errcode = '22023'; end if;
  select * into pl from players where id = p for update;
  if not found then raise exception 'player not found' using errcode = 'P0002'; end if;
  if pl.club_id is distinct from club_event_current_club() then raise exception 'forbidden' using errcode = '42501'; end if;
  nf := case when mode = 'per_visit' then coalesce(from_d, tbilisi_day(now())) else null end;
  if nf is not null and nf > tbilisi_day(now()) then raise exception 'date in the future' using errcode = '22023'; end if;
  if pl.pay_mode = mode and pl.pay_mode_from is not distinct from nf then
    if mode = 'per_visit' then perform own_visits_backfill(p); end if;
    return;
  end if;
  update players set pay_mode = mode, pay_mode_from = nf where id = p;
  insert into audit_log (actor_id, action, entity, entity_id, before, after)
  values (current_user_id(), 'player_pay_mode', 'players', p,
          jsonb_build_object('pay_mode', pl.pay_mode, 'pay_mode_from', pl.pay_mode_from),
          jsonb_build_object('pay_mode', mode, 'pay_mode_from', nf));
  if mode = 'per_visit' then perform own_visits_backfill(p); end if;
end $$;
revoke execute on function player_set_pay_mode(uuid, text, date) from public, anon;
grant execute on function player_set_pay_mode(uuid, text, date) to authenticated;
