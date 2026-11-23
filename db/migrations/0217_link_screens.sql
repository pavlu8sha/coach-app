-- 0217 (docs/acceptance/link-screens-2026-11-21.md): две функции ЧТЕНИЯ для экранов привязки ребёнка.
-- 1) my_link_requests(): свои запросы на привязку с именем ребёнка. До подтверждения родитель не видит строку players (RLS),
--    поэтому вложенный выбор players(full_name) давал null и экран писал «Игрок».
-- 2) my_pending_consents(): дети со связью, у которых доступ закрыт только потому, что родитель на новой модели согласий ещё не принял
--    текущую версию data_processing. Нужна экрану «Примите согласие»: принять можно через accept_consent(p, t, ver).
-- Существующие функции, RLS, таблицы и права не меняются. consent.mode не трогается.
create or replace function my_link_requests() returns table (id uuid, status text, player_id uuid, full_name text, group_name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if current_user_id() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select r.id, r.status, r.player_id, p.full_name, gr.name
    from link_requests r
    join players p on p.id = r.player_id
    left join groups gr on gr.id = p.group_id
   where r.user_id = current_user_id()
   order by r.created_at desc, r.id;
end $$;
revoke execute on function my_link_requests() from public, anon;
grant execute on function my_link_requests() to authenticated;

create or replace function my_pending_consents() returns table (player_id uuid, full_name text, group_name text, version_id uuid, version text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cur uuid;
begin
  if current_user_id() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  cur := consent_current_version('data_processing');
  if cur is null then return; end if;
  return query
  select p.id, p.full_name, gr.name, cur, v.version
    from player_guardians g
    join players p on p.id = g.player_id
    left join groups gr on gr.id = p.group_id
    join consent_doc_versions v on v.id = cur
   where g.user_id = current_user_id()
     and v.accepting
     and consent_new_model_for(g.user_id, g.player_id)
     and not has_consent(g.user_id, g.player_id, 'data_processing')
     -- согласие, снятое родителем или администратором, заново не предлагается; снятое системой (пересоздание связи) предлагается
     and not exists (select 1 from parental_consents pc
                       join parental_consent_events e on e.id = pc.last_event_id
                      where pc.parent_user_id = g.user_id and pc.player_id = g.player_id and pc.consent_type = 'data_processing'
                        and pc.status = 'revoked' and e.source <> 'system')
   order by p.full_name, p.id;
end $$;
revoke execute on function my_pending_consents() from public, anon;
grant execute on function my_pending_consents() to authenticated;
