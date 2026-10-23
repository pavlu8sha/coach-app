-- Согласие родителя фиксируется в момент запроса связи: версия текста и время. Подтверждая запрос, администратор
-- переносит эти значения в player_guardians. Версия должна быть в списке consent_versions (иначе запрос отклоняется).
create table consent_versions (
  version text primary key,
  active boolean not null default true,
  published_at timestamptz not null default now()
);
alter table consent_versions enable row level security;
create policy consent_versions_read on consent_versions for select using (auth.uid() is not null);
grant select on consent_versions to authenticated;
grant select, insert, update on consent_versions to service_role;
-- Черновик: текст в web/src/lib/consent.ts, юридическая проверка не пройдена (docs/CONSENT.md).
insert into consent_versions (version) values ('draft-2026-10');

alter table link_requests add column consent_version text, add column consent_given_at timestamptz;

drop function if exists request_link(uuid);
create or replace function request_link(p uuid, consent text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from consent_versions where version = consent and active) then raise exception 'consent required'; end if;
  if not exists (select 1 from players where id = p and status = 'active') then raise exception 'player not found'; end if;
  if (select count(*) from link_requests where user_id = current_user_id() and status = 'pending') >= 5 then
    raise exception 'too many pending requests';
  end if;
  insert into link_requests (user_id, player_id, consent_version, consent_given_at)
    values (current_user_id(), p, consent, now())
    on conflict (user_id, player_id) do nothing;
  select id into rid from link_requests where user_id = current_user_id() and player_id = p;
  return rid;
end $$;

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
      values (req.player_id, req.user_id, coalesce(req.consent_version, 'link-request-v0'), coalesce(req.consent_given_at, now()))
      on conflict (player_id, user_id) do update
        set consent_revoked_at = null, consent_version = excluded.consent_version, consent_given_at = excluded.consent_given_at;
  end if;
end $$;

revoke execute on function request_link(uuid, text) from public;
grant execute on function request_link(uuid, text) to authenticated;
