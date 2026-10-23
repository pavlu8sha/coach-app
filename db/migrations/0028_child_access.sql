-- 0028: роль «Ребёнок» — доступ к своим баллам и матчам по одноразовому коду от родителя.
-- Родитель (действующая связь с согласием) создаёт код для своего ребёнка; аккаунт с выбранной ролью «Ребёнок» вводит код
-- и привязывается к игроку. Видит ребёнок только своего игрока, его баллы и участие в матчах; оплаты и данные родителя закрыты.
-- Отзыв согласия родителем отключает и доступ ребёнка.

create table child_codes (
  code text primary key,
  player_id uuid not null references players(id) on delete cascade,
  created_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 days',
  used_at timestamptz
);

create table child_links (
  user_id uuid primary key references users(id) on delete cascade,
  player_id uuid not null unique references players(id) on delete cascade,
  linked_at timestamptz not null default now()
);

alter table child_codes enable row level security;  -- без политик: только через функции
alter table child_links enable row level security;
create policy child_links_read on child_links for select using (user_id = current_user_id() or is_admin());
grant select on child_links to authenticated;
grant select, insert, update, delete on child_codes, child_links to service_role;

-- Это игрок аккаунта-ребёнка, и у родителя ещё действует согласие.
create or replace function is_self_player(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from child_links c
    where c.player_id = p and c.user_id = current_user_id()
      and exists (select 1 from player_guardians g where g.player_id = p and g.consent_revoked_at is null)
  )
$$;
revoke execute on function is_self_player(uuid) from public, anon;
grant execute on function is_self_player(uuid) to authenticated;

drop policy if exists players_read on players;
create policy players_read on players for select
  using (is_admin() or is_coach_of_group(group_id) or is_guardian_of(id) or is_self_player(id));
drop policy if exists points_read on point_events;
create policy points_read on point_events for select
  using (is_admin() or is_coach_of_player(player_id) or is_guardian_of(player_id) or is_self_player(player_id));
drop policy if exists match_players_read on match_players;
create policy match_players_read on match_players for select
  using (is_admin() or is_guardian_of(player_id) or is_coach_of_player(player_id) or is_self_player(player_id));

-- Название своей группы видит и ребёнок (при действующем согласии родителя).
create or replace function is_guardian_in_group(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from players pl
    join player_guardians pg on pg.player_id = pl.id
    where pl.group_id = g and pg.consent_revoked_at is null
      and (pg.user_id = current_user_id() or exists (select 1 from child_links c where c.player_id = pl.id and c.user_id = current_user_id()))
  )
$$;

-- Родитель создаёт код для своего ребёнка (старые неиспользованные коды этого ребёнка гаснут).
create or replace function create_child_code(p uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text := ''; i int;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from child_codes where player_id = p and used_at is null;
  for i in 1..8 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
  insert into child_codes (code, player_id, created_by) values (c, p, current_user_id());
  return c;
end $$;

-- Ребёнок вводит код. Возвращает id игрока.
create or replace function redeem_child_code(c text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rec child_codes; role_ text;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select chosen_role into role_ from users where id = current_user_id();
  if role_ is distinct from 'child' then raise exception 'wrong role' using errcode = '42501'; end if;
  select * into rec from child_codes where code = upper(trim(c)) and used_at is null and expires_at > now() for update;
  if not found then raise exception 'invalid code' using errcode = '22023'; end if;
  if not exists (select 1 from player_guardians where player_id = rec.player_id and consent_revoked_at is null) then
    raise exception 'invalid code' using errcode = '22023';
  end if;
  if exists (select 1 from child_links where player_id = rec.player_id and user_id <> current_user_id()) then
    raise exception 'already linked' using errcode = '23505';
  end if;
  insert into child_links (user_id, player_id) values (current_user_id(), rec.player_id)
    on conflict (user_id) do update set player_id = excluded.player_id, linked_at = now();
  update child_codes set used_at = now() where code = rec.code;
  insert into audit_log (actor_id, action, entity, entity_id, after)
    values (current_user_id(), 'child_link', 'child_links', rec.player_id, jsonb_build_object('player_id', rec.player_id, 'code_by', rec.created_by));
  return rec.player_id;
end $$;

-- Родитель отвязывает аккаунт ребёнка.
create or replace function unlink_child(p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from child_links where player_id = p;
  delete from child_codes where player_id = p and used_at is null;
end $$;

-- Родитель видит, привязан ли у ребёнка аккаунт (без доступа к самим таблицам).
create or replace function child_linked(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_guardian_of(p) and exists (select 1 from child_links where player_id = p)
$$;

revoke execute on function create_child_code(uuid), redeem_child_code(text), unlink_child(uuid), child_linked(uuid) from public, anon;
grant execute on function create_child_code(uuid), redeem_child_code(text), unlink_child(uuid), child_linked(uuid) to authenticated;
