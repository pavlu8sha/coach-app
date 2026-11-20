-- 0209: имя, основная позиция и игровой номер в профиле игрока (#654, этап 1).
-- Условия: docs/PLAYER_PROFILE_ATTRIBUTES_ACCEPTANCE.md.
--  * first_name/last_name хранятся отдельно; full_name остаётся совместимым полным именем.
--  * primary_position — свободный текст до 40 символов.
--  * jersey_number — 1..99, только для командной группы, уникален в команде и сезоне.
--  * Команда: U7-A/U7-B -> U7; U13-A -> U13-A; U13-B/U13-C -> U13-B/C; остальные U<число>-<буква> -> U<число>.
--  * Сезон: с 1 сентября. При смене команды номер закрывается и остаётся в истории.
--  * Новые поля вынесены из players: players_read (0042) виден любому тренеру, а профиль — только
--    администратору, тренеру текущей группы, родителю и самому ребёнку.
--  * История пишется триггерами; прямая запись в историю запрещена.
-- Откат: db/ops/rollback-0209-player-profile-attributes.sql.
begin;

-- Команда по названию группы. Не-team группы (индивидуальные, вратарские, weekends, Isani) -> null.
create or replace function player_team(group_name text) returns text
language sql immutable as $$
  select case
    when v is null or v = '' then null
    when v ~ '^U13-[BC]$' then 'U13-B/C'
    when v ~ '^U13-A$' then 'U13-A'
    when v ~ '^U[0-9]+-[A-Z]$' then regexp_replace(v, '-[A-Z]$', '')
    when v ~ '^U[0-9]+$' then v
    else null
  end
  from (select upper(btrim(group_name)) as v) x
$$;
revoke execute on function player_team(text) from public, anon;
grant execute on function player_team(text) to authenticated;

-- Начало сезона для номера: 1 сентября.
create or replace function current_season_start(d date) returns date
language sql immutable as $$
  select case
    when extract(month from d) >= 9 then make_date(extract(year from d)::int, 9, 1)
    else make_date(extract(year from d)::int - 1, 9, 1)
  end
$$;
revoke execute on function current_season_start(date) from public, anon;
grant execute on function current_season_start(date) to authenticated;

-- Команда игрока по текущей группе.
create or replace function player_team_of(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select player_team(g.name)
  from players pl
  left join groups g on g.id = pl.group_id
  where pl.id = p
$$;
revoke execute on function player_team_of(uuid) from public, anon, authenticated;

create table player_profiles (
  player_id uuid primary key references players(id) on delete cascade,
  first_name text,
  last_name text,
  primary_position text,
  jersey_number integer,
  jersey_team text,
  jersey_season_start date,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null,
  check (first_name is null or (btrim(first_name) <> '' and char_length(first_name) <= 60)),
  check (last_name is null or (btrim(last_name) <> '' and char_length(last_name) <= 60)),
  check (primary_position is null or (btrim(primary_position) <> '' and char_length(primary_position) <= 40)),
  check (jersey_number is null or jersey_number between 1 and 99),
  check ((jersey_number is null) = (jersey_team is null)),
  check ((jersey_number is null) = (jersey_season_start is null))
);

create table player_profile_history (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  field text not null check (field in ('first_name', 'last_name', 'primary_position')),
  old_value text,
  new_value text,
  changed_at timestamptz not null default now(),
  changed_by uuid references users(id) on delete set null
);
create index player_profile_history_lookup on player_profile_history (player_id, changed_at desc);

create table player_jersey_history (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  team text not null,
  season_start date not null,
  number integer not null check (number between 1 and 99),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  changed_by uuid references users(id) on delete set null,
  check (valid_to is null or valid_to >= valid_from)
);
create unique index player_jersey_history_open_number on player_jersey_history (team, season_start, number) where valid_to is null;
create unique index player_jersey_history_open_player on player_jersey_history (player_id) where valid_to is null;
create index player_jersey_history_lookup on player_jersey_history (player_id, valid_from desc);

alter table player_profiles enable row level security;
alter table player_profile_history enable row level security;
alter table player_jersey_history enable row level security;

revoke all on player_profiles, player_profile_history, player_jersey_history from public, anon, authenticated;
grant select, insert, update, delete on player_profiles to authenticated;
grant select on player_profile_history, player_jersey_history to authenticated;
grant all on player_profiles, player_profile_history, player_jersey_history to service_role;

create policy player_profiles_read on player_profiles for select
  using (is_admin() or is_coach_of_player(player_id) or is_guardian_of(player_id) or is_self_player(player_id));
create policy player_profiles_admin_write on player_profiles for all
  using (is_admin()) with check (is_admin());
create policy player_profile_history_admin_read on player_profile_history for select
  using (is_admin());
create policy player_jersey_history_admin_read on player_jersey_history for select
  using (is_admin());

-- Пустой профиль создаётся для каждого игрока; имена, позиция и номер заполняются администратором.
create or replace function player_profiles_create() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into player_profiles (player_id) values (new.id)
  on conflict (player_id) do nothing;
  return null;
end $$;
revoke execute on function player_profiles_create() from public, anon, authenticated;
create trigger players_create_profile after insert on players
  for each row execute function player_profiles_create();

-- При смене команды действующий номер закрывается. Переход внутри одной команды (U7-A -> U7-B,
-- U13-B -> U13-C) номер сохраняет.
create or replace function players_clear_jersey_on_team_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_team text;
  new_team text;
begin
  if old.group_id is not distinct from new.group_id then
    return null;
  end if;
  select player_team(g.name) into old_team from groups g where g.id = old.group_id;
  select player_team(g.name) into new_team from groups g where g.id = new.group_id;
  if old_team is distinct from new_team then
    update player_profiles
       set jersey_number = null,
           jersey_team = null,
           jersey_season_start = null,
           updated_at = now(),
           updated_by = current_user_id()
     where player_id = new.id
       and jersey_number is not null;
  end if;
  return null;
end $$;
revoke execute on function players_clear_jersey_on_team_change() from public, anon, authenticated;
create trigger players_clear_jersey_on_team_change after update of group_id on players
  for each row execute function players_clear_jersey_on_team_change();

-- Нормализация и серверная проверка номера до записи.
create or replace function player_profiles_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team text;
  v_season date;
begin
  new.first_name := nullif(btrim(new.first_name), '');
  new.last_name := nullif(btrim(new.last_name), '');
  new.primary_position := nullif(btrim(new.primary_position), '');
  new.updated_at := now();
  new.updated_by := current_user_id();

  if new.jersey_number is not null then
    v_team := player_team_of(new.player_id);
    if v_team is null then
      raise exception 'jersey number is available only for a team group' using errcode = '22023';
    end if;
    v_season := current_season_start(tbilisi_day(now()));
    new.jersey_team := v_team;
    new.jersey_season_start := v_season;
    if exists (
      select 1 from player_jersey_history h
      where h.team = v_team and h.season_start = v_season and h.number = new.jersey_number
        and h.valid_to is null and h.player_id <> new.player_id
    ) then
      raise exception 'jersey number % is already taken in % for season %', new.jersey_number, v_team, v_season
        using errcode = '23505';
    end if;
  else
    new.jersey_team := null;
    new.jersey_season_start := null;
  end if;
  return new;
end $$;
revoke execute on function player_profiles_before_write() from public, anon, authenticated;
create trigger player_profiles_jersey_guard before insert or update on player_profiles
  for each row execute function player_profiles_before_write();

-- История и синхронизация full_name после записи профиля.
create or replace function player_profiles_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_by uuid := current_user_id();
  v_now timestamptz := now();
  v_full text;
begin
  if tg_op = 'INSERT' then
    if new.first_name is not null then
      insert into player_profile_history (player_id, field, old_value, new_value, changed_at, changed_by)
      values (new.player_id, 'first_name', null, new.first_name, v_now, v_by);
    end if;
    if new.last_name is not null then
      insert into player_profile_history (player_id, field, old_value, new_value, changed_at, changed_by)
      values (new.player_id, 'last_name', null, new.last_name, v_now, v_by);
    end if;
    if new.primary_position is not null then
      insert into player_profile_history (player_id, field, old_value, new_value, changed_at, changed_by)
      values (new.player_id, 'primary_position', null, new.primary_position, v_now, v_by);
    end if;
    if new.jersey_number is not null then
      insert into player_jersey_history (player_id, team, season_start, number, valid_from, changed_by)
      values (new.player_id, new.jersey_team, new.jersey_season_start, new.jersey_number, v_now, v_by);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.first_name is distinct from new.first_name then
      insert into player_profile_history (player_id, field, old_value, new_value, changed_at, changed_by)
      values (new.player_id, 'first_name', old.first_name, new.first_name, v_now, v_by);
    end if;
    if old.last_name is distinct from new.last_name then
      insert into player_profile_history (player_id, field, old_value, new_value, changed_at, changed_by)
      values (new.player_id, 'last_name', old.last_name, new.last_name, v_now, v_by);
    end if;
    if old.primary_position is distinct from new.primary_position then
      insert into player_profile_history (player_id, field, old_value, new_value, changed_at, changed_by)
      values (new.player_id, 'primary_position', old.primary_position, new.primary_position, v_now, v_by);
    end if;
    if old.jersey_number is distinct from new.jersey_number
       or old.jersey_team is distinct from new.jersey_team
       or old.jersey_season_start is distinct from new.jersey_season_start then
      update player_jersey_history set valid_to = v_now
       where player_id = new.player_id and valid_to is null;
      if new.jersey_number is not null then
        insert into player_jersey_history (player_id, team, season_start, number, valid_from, changed_by)
        values (new.player_id, new.jersey_team, new.jersey_season_start, new.jersey_number, v_now, v_by);
      end if;
    end if;
  end if;

  if new.first_name is not null and new.last_name is not null then
    v_full := new.last_name || ' ' || new.first_name;
    update players set full_name = v_full
     where id = new.player_id and full_name is distinct from v_full;
  end if;
  return null;
end $$;
revoke execute on function player_profiles_after_write() from public, anon, authenticated;
create trigger player_profiles_history after insert or update on player_profiles
  for each row execute function player_profiles_after_write();

-- Удаление профиля закрывает действующий номер; игрок при этом не удаляется.
create or replace function player_profiles_close_jersey() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update player_jersey_history set valid_to = now()
   where player_id = old.player_id and valid_to is null;
  return null;
end $$;
revoke execute on function player_profiles_close_jersey() from public, anon, authenticated;
create trigger player_profiles_close_jersey after delete on player_profiles
  for each row execute function player_profiles_close_jersey();

-- Профили для уже существующих игроков. Имена не разбираем: first_name/last_name остаются пустыми.
insert into player_profiles (player_id)
select p.id from players p
on conflict (player_id) do nothing;

commit;
