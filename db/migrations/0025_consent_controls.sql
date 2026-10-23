-- Управление согласием и данными родителем (handoff, п. 5): отзыв согласия, выгрузка своих данных, запрос на удаление.
-- Юридические сроки хранения и состав удаляемого решает владелец (docs/DATA_REQUESTS.md); здесь — механика.

-- 1. Отзыв согласия по ребёнку: связь отключается (ребёнок и его данные пропадают у родителя), отметка об отзыве остаётся
-- в player_guardians как запись о факте отзыва. Прежний запрос на связь удаляется, чтобы при желании родитель мог подать новый
-- запрос и дать согласие заново.
create or replace function revoke_consent(p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update player_guardians set consent_revoked_at = now()
   where player_id = p and user_id = current_user_id() and consent_revoked_at is null;
  if not found then raise exception 'link not found'; end if;
  delete from link_requests where user_id = current_user_id() and player_id = p;
  insert into audit_log (actor_id, action, entity, entity_id, after)
    values (current_user_id(), 'revoke_consent', 'player_guardians', p, jsonb_build_object('player_id', p));
end $$;

-- 2. Выгрузка своих данных одним JSON: аккаунт, дети с отметками о согласии, запросы, а по детям с действующим согласием —
-- посещаемость, баллы, платежи и участие в матчах. Чужих данных нет: только то, что родитель и так видит в приложении.
create or replace function export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := current_user_id(); res jsonb;
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  with kids as (
    select pl.id, pl.full_name, g.name gname, pg.consent_version, pg.consent_given_at, pg.consent_revoked_at
    from player_guardians pg join players pl on pl.id = pg.player_id left join groups g on g.id = pl.group_id
    where pg.user_id = me
  ), active as (select * from kids where consent_revoked_at is null)
  select jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('display_name', u.display_name, 'telegram_id', u.telegram_id, 'created_at', u.created_at) from users u where u.id = me),
    'children', coalesce((select jsonb_agg(jsonb_build_object('name', full_name, 'group', gname, 'consent_version', consent_version, 'consent_given_at', consent_given_at, 'consent_revoked_at', consent_revoked_at) order by full_name) from kids), '[]'::jsonb),
    'link_requests', coalesce((select jsonb_agg(jsonb_build_object('child', pl.full_name, 'status', r.status, 'created_at', r.created_at, 'decided_at', r.decided_at, 'consent_version', r.consent_version) order by r.created_at) from link_requests r join players pl on pl.id = r.player_id where r.user_id = me), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object('child', a2.full_name, 'date', tbilisi_day(s.starts_at), 'status', at.status) order by s.starts_at) from attendance at join sessions s on s.id = at.session_id join active a2 on a2.id = at.player_id), '[]'::jsonb),
    'points', coalesce((select jsonb_agg(jsonb_build_object('child', a2.full_name, 'date', e.occurred_on, 'points', e.points, 'explanation', e.explanation) order by e.occurred_on) from point_events e join active a2 on a2.id = e.player_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('child', a2.full_name, 'date', p.paid_on, 'amount', p.amount, 'method', p.method) order by p.paid_on) from payments p join active a2 on a2.id = p.player_id), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('child', a2.full_name, 'date', m.played_on, 'team', m.team, 'opponent', m.opponent, 'played', mp.played, 'goals', mp.goals) order by m.played_on) from match_players mp join matches m on m.id = mp.match_id join active a2 on a2.id = mp.player_id), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- 3. Запросы на удаление данных: родитель подаёт, администратор обрабатывает. Одновременно один открытый запрос.
create table data_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('delete')),
  status text not null default 'open' check (status in ('open', 'done', 'rejected')),
  created_at timestamptz not null default now(),
  handled_by uuid references users(id),
  handled_at timestamptz,
  note text
);
create unique index data_requests_one_open on data_requests (user_id, kind) where status = 'open';
alter table data_requests enable row level security;
create policy data_requests_read on data_requests for select using (is_admin() or user_id = current_user_id());
grant select on data_requests to authenticated;
grant select, insert, update, delete on data_requests to service_role;

create or replace function request_data_deletion() returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if exists (select 1 from data_requests where user_id = current_user_id() and kind = 'delete' and status = 'open') then
    raise exception 'request already open';
  end if;
  insert into data_requests (user_id, kind) values (current_user_id(), 'delete') returning id into rid;
  return rid;
end $$;

-- Отклонить запрос (с пометкой). «Выполнено» ставит erase_parent.
create or replace function reject_data_request(r uuid, why text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update data_requests set status = 'rejected', handled_by = current_user_id(), handled_at = now(), note = nullif(trim(coalesce(why, '')), '')
   where id = r and status = 'open';
  if not found then raise exception 'request not found or already handled'; end if;
end $$;

-- Выполнить запрос на удаление данных родителя: убираем связи с детьми, запросы и отметки согласия, имя в профиле.
-- Не трогаем: игроков и их данные (они принадлежат клубу), строку users с Telegram ID (нужна для входа и целостности),
-- журнал аудита. Для администратора и тренеров не работает (за ними числятся действия в журналах).
-- Учётную запись в Authentication владелец при необходимости удаляет вручную (там хранится имя из Telegram).
create or replace function erase_parent(r uuid) returns void
language plpgsql security definer set search_path = public as $$
declare req data_requests; links int; reqs int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into req from data_requests where id = r and status = 'open';
  if req.id is null then raise exception 'request not found or already handled'; end if;
  if exists (select 1 from users where id = req.user_id and is_admin) or exists (select 1 from coach_groups where user_id = req.user_id) then
    raise exception 'user is admin or coach';
  end if;
  delete from player_guardians where user_id = req.user_id; get diagnostics links = row_count;
  delete from link_requests where user_id = req.user_id; get diagnostics reqs = row_count;
  update users set display_name = null where id = req.user_id;
  update data_requests set status = 'done', handled_by = current_user_id(), handled_at = now() where id = r;
  insert into audit_log (actor_id, action, entity, entity_id, after)
    values (current_user_id(), 'erase_parent', 'users', req.user_id, jsonb_build_object('guardian_links', links, 'link_requests', reqs));
end $$;

revoke execute on function revoke_consent(uuid), export_my_data(), request_data_deletion(), reject_data_request(uuid, text), erase_parent(uuid) from public;
grant execute on function revoke_consent(uuid), export_my_data(), request_data_deletion(), reject_data_request(uuid, text), erase_parent(uuid) to authenticated;
