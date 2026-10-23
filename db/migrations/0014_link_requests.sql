-- Запросы родителей на связь с ребёнком. Родитель ищет ребёнка по имени (минимум 3 буквы, до 5 результатов,
-- только имя и группа) и подаёт запрос; связь player_guardians создаёт ТОЛЬКО администратор, подтвердив запрос.
-- Весь список игроков родителям не раскрывается: поиск идёт через функцию, а не через чтение таблицы players.

create table link_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references users(id),
  unique (user_id, player_id)
);

alter table link_requests enable row level security;
-- Читать: свои запросы и администратор. Политик на запись нет: пишут только функции ниже.
create policy link_requests_read on link_requests for select
  using (is_admin() or user_id = current_user_id());

grant select on link_requests to authenticated;
grant select, insert, update, delete on link_requests to service_role;

create or replace function search_players_for_link(q text)
returns table (player_id uuid, full_name text, group_name text)
language plpgsql stable security definer set search_path = public as $$
declare t text := trim(coalesce(q, ''));
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if char_length(t) < 3 then return; end if;
  t := replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select p.id, p.full_name, g.name
    from players p left join groups g on g.id = p.group_id
    where p.status = 'active'
      and p.full_name ilike '%' || t || '%'
      and not exists (select 1 from player_guardians pg where pg.player_id = p.id and pg.user_id = current_user_id() and pg.consent_revoked_at is null)
      and not exists (select 1 from link_requests r where r.player_id = p.id and r.user_id = current_user_id())
    order by p.full_name
    limit 5;
end $$;

create or replace function request_link(p uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from players where id = p and status = 'active') then raise exception 'player not found'; end if;
  if (select count(*) from link_requests where user_id = current_user_id() and status = 'pending') >= 5 then
    raise exception 'too many pending requests';
  end if;
  insert into link_requests (user_id, player_id) values (current_user_id(), p)
    on conflict (user_id, player_id) do nothing;
  select id into rid from link_requests where user_id = current_user_id() and player_id = p;
  return rid;
end $$;

-- Подтвердить или отклонить запрос — только администратор.
-- consent_version 'link-request-v0': временная отметка, пока нет юридически проверенного текста согласия.
create or replace function decide_link(r uuid, approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare req link_requests;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update link_requests
     set status = case when approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = current_user_id()
   where id = r and status = 'pending'
   returning * into req;
  if req.id is null then raise exception 'request not found or already decided'; end if;
  if approve then
    insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
      values (req.player_id, req.user_id, 'link-request-v0', now())
      on conflict (player_id, user_id) do update set consent_revoked_at = null, consent_given_at = now();
  end if;
end $$;

revoke execute on function search_players_for_link(text), request_link(uuid), decide_link(uuid, boolean) from public;
grant execute on function search_players_for_link(text), request_link(uuid), decide_link(uuid, boolean) to authenticated;
