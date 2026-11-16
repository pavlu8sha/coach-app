-- ОТКАТ 0199: возвращает decide_link с телом из 0173 (без потолка опекунов и проверки клуба). Сначала db/ops/preflight.sql.
begin;
CREATE OR REPLACE FUNCTION public.decide_link(r uuid, approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare req link_requests; created boolean; c record;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock_shared(hashtext('parental_consent_model'));
  update link_requests
     set status = case when approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = current_user_id()
   where id = r and status = 'pending'
   returning * into req;
  if req.id is null then raise exception 'request not found or already decided'; end if;
  if approve then
    insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
      values (req.player_id, req.user_id, coalesce(req.consent_version, 'link-request-v0'), coalesce(req.consent_given_at, now()))
      on conflict (player_id, user_id) do update
        -- родитель на новой модели: прежние поля существующей связи не трогаем (согласие принимает сам); иначе как раньше
        set consent_revoked_at = case when consent_new_model_for(excluded.user_id, excluded.player_id) then player_guardians.consent_revoked_at else null end,
            consent_version = case when consent_new_model_for(excluded.user_id, excluded.player_id) then player_guardians.consent_version else excluded.consent_version end,
            consent_given_at = case when consent_new_model_for(excluded.user_id, excluded.player_id) then player_guardians.consent_given_at else excluded.consent_given_at end
      returning (xmax = 0) into created;
    if created then
      for c in select consent_type from parental_consents
                where parent_user_id = req.user_id and player_id = req.player_id and status = 'granted' order by consent_type loop
        perform consent_record(req.user_id, req.player_id, c.consent_type, 'revoked', null, 'system', current_user_id());
      end loop;
    end if;
  end if;
end $function$;
revoke execute on function decide_link(uuid, boolean) from public, anon;
grant execute on function decide_link(uuid, boolean) to authenticated;
commit;
