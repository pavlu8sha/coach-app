-- 0104: статусы игрока «занимается / пауза / ушёл», даты и журнал изменений (решение владельца 2026-11-02).
-- Пауза: игрок не уходил из клуба и вернётся; плата за паузу не берётся. Это работает без правок функций долга:
-- debtors() и «Абонементы на месяц» берут только players.status = 'active', а пауза и «ушёл» ему не равны.
-- Статус 'inactive' в базе остаётся как есть (значение «ушёл»; гости из импорта тоже inactive).
-- Смена статуса только через player_set_status (администратор): пишет журнал, ставит ends_on при уходе, снимает при возврате.
-- Применять в SQL Editor целиком, сначала db/ops/preflight.sql; перед применением CSV-выгрузка таблицы players.
begin;

-- расширяем check по статусу: имя ограничения могло отличаться, поэтому ищем его по определению
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'players'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table players drop constraint %I', c);
  end loop;
end $$;
alter table players add constraint players_status_check check (status in ('active', 'paused', 'inactive'));

create table player_status_log (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  status text not null check (status in ('active', 'paused', 'inactive')),
  on_date date not null,      -- с какой даты действует статус
  until_on date,              -- для паузы: плановая дата возвращения (необязательно)
  comment text,
  changed_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index player_status_log_player on player_status_log (player_id, on_date desc, created_at desc);
alter table player_status_log enable row level security;
create policy player_status_log_read on player_status_log for select using (is_admin() or is_coach_of_player(player_id));
grant select on player_status_log to authenticated;
grant all on player_status_log to service_role;

-- смена статуса игрока: только администратор
create function player_set_status(p uuid, s text, d date, until date, note text) returns void
language plpgsql security definer set search_path = public as $$
declare day date := coalesce(d, tbilisi_day(now()));
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if s not in ('active', 'paused', 'inactive') then raise exception 'invalid status'; end if;
  if until is not null and (s <> 'paused' or until < day) then raise exception 'invalid return date'; end if;
  update players
     set status = s,
         ends_on = case when s = 'inactive' then day else null end,
         starts_on = case when s = 'active' and starts_on is null then day else starts_on end
   where id = p;
  if not found then raise exception 'player not found'; end if;
  insert into player_status_log (player_id, status, on_date, until_on, comment, changed_by)
    values (p, s, day, until, nullif(trim(coalesce(note, '')), ''), current_user_id());
end $$;
revoke execute on function player_set_status(uuid, text, date, date, text) from public, anon;
grant execute on function player_set_status(uuid, text, date, date, text) to authenticated;

commit;
