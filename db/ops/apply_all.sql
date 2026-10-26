-- Миграции 0051–0051 одной транзакцией. Сгенерировано scripts/make-apply-bundle.sh 0051.
-- Перед запуском выполните db/ops/preflight.sql: все номера от 0051 должны быть applied = false. После: db/ops/postcheck.sql.
begin;

-- ===== 0051_events.sql =====
-- 0051: события (чемпионат, фестиваль, кубок): создание, состав участников, игры события.
-- Тренеры и администратор создают событие и ведут состав; сумма взноса и оплаты остаются только у администратора
-- (таблицы tournaments и tournament_fees закрыты RLS, тренеры работают через функции ниже).

create or replace function event_assert_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

-- Список событий со счётчиками (без сумм)
create or replace function event_list()
returns table (id uuid, team text, kind text, name text, starts_on date, players int, games int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_staff();
  return query
    select t.id, t.team, t.kind, t.name, t.starts_on,
           (select count(*)::int from tournament_fees f where f.tournament_id = t.id),
           (select count(*)::int from matches m where m.tournament_id = t.id)
      from tournaments t
     order by t.starts_on desc nulls last, t.name;
end $$;

-- Создание события; взнос задаёт только администратор, copy_from копирует состав другого события
create or replace function event_create(k text, tm text, nm text, d date, fee numeric, copy_from uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare club uuid; tid uuid; amount numeric(10,2) := 0;
begin
  perform event_assert_staff();
  if k not in ('championship', 'festival', 'cup') then raise exception 'invalid kind'; end if;
  if nullif(trim(tm), '') is null then raise exception 'team required'; end if;
  select g.club_id into club from groups g where g.name = trim(tm) limit 1;
  if club is null then select c.id into club from clubs c order by c.id limit 1; end if;
  if is_admin() and fee is not null then
    if fee < 0 then raise exception 'invalid fee'; end if;
    amount := fee;
  end if;
  insert into tournaments (club_id, team, kind, name, fee, starts_on)
    values (club, trim(tm), k, nullif(trim(nm), ''), amount, d) returning id into tid;
  if copy_from is not null then
    insert into tournament_fees (tournament_id, player_id, amount)
      select tid, f.player_id, amount from tournament_fees f where f.tournament_id = copy_from
      on conflict do nothing;
  end if;
  return tid;
end $$;

-- Состав события (имена без денег)
create or replace function event_roster(t uuid)
returns table (player_id uuid, full_name text, group_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_staff();
  return query
    select p.id, p.full_name, g.name
      from tournament_fees f join players p on p.id = f.player_id left join groups g on g.id = p.group_id
     where f.tournament_id = t
     order by p.full_name;
end $$;

create or replace function event_roster_add(t uuid, ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare ev tournaments;
begin
  perform event_assert_staff();
  select * into ev from tournaments where id = t;
  if ev.id is null then raise exception 'event not found'; end if;
  insert into tournament_fees (tournament_id, player_id, amount)
    select t, p.id, ev.fee from players p where p.id = any (ids) and p.club_id = ev.club_id
    on conflict do nothing;
end $$;

create or replace function event_roster_remove(t uuid, pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform event_assert_staff();
  if exists (select 1 from tournament_fees where tournament_id = t and player_id = pid and paid) then
    raise exception 'fee already paid';
  end if;
  delete from tournament_fees where tournament_id = t and player_id = pid;
end $$;

-- Игра события: пустой матч команды события, состав и счёт вносятся обычной формой матча
create or replace function event_add_game(t uuid, d date, opp text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ev tournaments; mid uuid;
begin
  perform event_assert_staff();
  select * into ev from tournaments where id = t;
  if ev.id is null then raise exception 'event not found'; end if;
  insert into matches (club_id, played_on, team, opponent, kind, tournament_id)
    values (ev.club_id, d, ev.team, nullif(trim(opp), ''), 'game', t) returning id into mid;
  return mid;
end $$;

revoke execute on function event_assert_staff() from public, anon, authenticated;
revoke execute on function event_list() from public, anon;
revoke execute on function event_create(text, text, text, date, numeric, uuid) from public, anon;
revoke execute on function event_roster(uuid) from public, anon;
revoke execute on function event_roster_add(uuid, uuid[]) from public, anon;
revoke execute on function event_roster_remove(uuid, uuid) from public, anon;
revoke execute on function event_add_game(uuid, date, text) from public, anon;
grant execute on function event_list() to authenticated;
grant execute on function event_create(text, text, text, date, numeric, uuid) to authenticated;
grant execute on function event_roster(uuid) to authenticated;
grant execute on function event_roster_add(uuid, uuid[]) to authenticated;
grant execute on function event_roster_remove(uuid, uuid) to authenticated;
grant execute on function event_add_game(uuid, date, text) to authenticated;

commit;
