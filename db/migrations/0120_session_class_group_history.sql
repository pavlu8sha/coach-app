-- 0120: тип занятия и история тренировочных групп игрока (#18, этап 4).
--  * sessions.class: regular (по расписанию, входит в серию), moved (перенесённая обычная, +1 без серии), unscheduled (внеплановая, +2 без серии).
--    Старые занятия получают regular. Для индивидуальных, вратарских и дополнительных тип задан таблицами.
--  * open_session_special: занятие вне слота расписания, тип выбирает тренер или администратор (open_session остаётся для обычных).
--  * player_group_history и points_group_at(игрок, дата): тренировочная группа игрока на дату события. Ведётся триггером на players.group_id.
-- Начисления не подключены. Старые point_events и points_start не затрагиваются.
-- Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

alter table sessions add column class text not null default 'regular' check (class in ('regular', 'moved', 'unscheduled'));

-- Занятие вне слота расписания. Ключ включает дату, тип и время: в один день у группы может быть и обычное, и дополнительное занятие.
create or replace function open_session_special(g uuid, d date, t time, cls text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; key text;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if cls not in ('moved', 'unscheduled') then raise exception 'invalid class' using errcode = '22023'; end if;
  if d is null or t is null then raise exception 'date and time required' using errcode = '22023'; end if;
  if d > tbilisi_day(now()) then raise exception 'date in the future'; end if;
  if not exists (select 1 from groups where id = g) then raise exception 'group not found' using errcode = 'P0002'; end if;
  key := 'ATT|' || d || '|' || cls || '|' || to_char(t, 'HH24MI');
  insert into sessions (group_id, starts_at, kind, source_key, class)
    values (g, (d + t) at time zone 'Asia/Tbilisi', 'training', key, cls)
    on conflict (group_id, source_key) do nothing;
  select id into sid from sessions where group_id = g and source_key = key;
  return sid;
end $$;
revoke execute on function open_session_special(uuid, date, time, text) from public, anon;
grant execute on function open_session_special(uuid, date, time, text) to authenticated;

-- История групп. valid_to не включается; пустой valid_to = текущая группа. Первая строка игрока начинается с 1970-01-01.
create table player_group_history (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  group_id uuid references groups(id),
  valid_from date not null,
  valid_to date,
  check (valid_to is null or valid_to > valid_from)
);
create unique index player_group_history_one_open on player_group_history (player_id) where valid_to is null;
create index player_group_history_lookup on player_group_history (player_id, valid_from);

alter table player_group_history enable row level security;
create policy player_group_history_admin on player_group_history for select using (is_admin());
revoke all on player_group_history from authenticated, anon;
grant select on player_group_history to authenticated;
grant select, insert, update on player_group_history to service_role;

-- Ведётся только триггером. Смена группы в тот же день правит открытую строку, а не плодит пустые интервалы.
create or replace function players_group_history_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := tbilisi_day(now()); op player_group_history;
begin
  if tg_op = 'INSERT' then
    insert into player_group_history (player_id, group_id, valid_from) values (new.id, new.group_id, date '1970-01-01');
    return null;
  end if;
  if new.group_id is not distinct from old.group_id then return null; end if;
  select * into op from player_group_history where player_id = new.id and valid_to is null;
  if op.id is null then
    insert into player_group_history (player_id, group_id, valid_from) values (new.id, new.group_id, date '1970-01-01');
  elsif op.valid_from >= today then
    update player_group_history set group_id = new.group_id where id = op.id;
  else
    update player_group_history set valid_to = today where id = op.id;
    insert into player_group_history (player_id, group_id, valid_from) values (new.id, new.group_id, today);
  end if;
  return null;
end $$;
create trigger players_group_history_ins after insert on players for each row execute function players_group_history_sync();
create trigger players_group_history_upd after update of group_id on players for each row execute function players_group_history_sync();
revoke execute on function players_group_history_sync() from public, anon, authenticated;

-- Текущее состояние существующих игроков
insert into player_group_history (player_id, group_id, valid_from)
select p.id, p.group_id, date '1970-01-01' from players p
where not exists (select 1 from player_group_history h where h.player_id = p.id);

-- Тренировочная группа игрока на дату. Служебная функция для расчёта начислений, приложению недоступна.
create or replace function points_group_at(p uuid, d date) returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from player_group_history
   where player_id = p and valid_from <= d and (valid_to is null or valid_to > d)
   order by valid_from desc limit 1
$$;
revoke execute on function points_group_at(uuid, date) from public, anon, authenticated;

commit;
