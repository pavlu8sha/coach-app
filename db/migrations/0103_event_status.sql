-- 0103: статус события (чемпионат, фестиваль, кубок): идёт или завершён.
-- Нужен, чтобы в «Добавить матч» предлагались только идущие соревнования (решение владельца 2026-11-02).
-- Статус меняет только администратор (event_set_status). Новые события создаются идущими (default 'active').
-- Уже созданные события (решение владельца): «Championship 2» идёт, все остальные завершены.
-- Применять в SQL Editor целиком, сначала db/ops/preflight.sql; перед применением CSV-выгрузка таблицы tournaments.
begin;

alter table tournaments add column status text not null default 'active' check (status in ('active', 'finished'));

-- разовая разметка существующих событий
update tournaments set status = case when lower(trim(coalesce(name, ''))) = 'championship 2' then 'active' else 'finished' end;

-- event_list из 0094 + status
drop function if exists event_list();
create function event_list()
returns table (id uuid, team text, kind text, name text, starts_on date, players int, games int, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_staff();
  return query
    select t.id, t.team, t.kind, t.name, t.starts_on,
           (select count(*)::int from tournament_fees f where f.tournament_id = t.id),
           (select count(*)::int from matches m where m.tournament_id = t.id),
           t.status
      from tournaments t
     order by t.starts_on desc nulls last, t.name;
end $$;
revoke execute on function event_list() from public, anon;
grant execute on function event_list() to authenticated;

-- смена статуса: только администратор
create function event_set_status(t uuid, s text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if s not in ('active', 'finished') then raise exception 'invalid status'; end if;
  update tournaments set status = s where id = t;
  if not found then raise exception 'event not found'; end if;
end $$;
revoke execute on function event_set_status(uuid, text) from public, anon;
grant execute on function event_set_status(uuid, text) to authenticated;

commit;
