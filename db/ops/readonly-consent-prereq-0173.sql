-- #238, PR 2b: можно ли применять миграцию 0173. Только чтение, ничего не меняет. Запустить в SQL Editor целиком.
-- Все строки должны быть true. 0173 пересоздаёт функции из перечисленных миграций: если какая-то не применена, сначала она,
-- иначе её позднее применение вернёт старое условие consent_revoked_at. Если есть false, 0173 не применять.
select * from (values
  ('0148_booking_notifications применена', coalesce((to_regproc('booking_family_notice') is not null), false)),
  ('0150_individual_times применена', coalesce((to_regproc('booking_conflicts') is not null), false)),
  ('0151_first_wave применена', coalesce((to_regproc('first_wave_friday') is not null), false)),
  ('0152_waitlist_bot_button применена', coalesce((to_regproc('waitlist_claim_by_telegram') is not null), false)),
  ('0158_booking_telegram применена', coalesce((to_regproc('booking_signup_by_telegram') is not null and to_regproc('waitlist_join_by_telegram') is not null and to_regproc('booking_options_by_telegram') is not null), false)),
  ('0159_consent_model применена', coalesce((to_regclass('parental_consents') is not null and to_regclass('parental_consent_events') is not null and to_regclass('consent_doc_versions') is not null and to_regproc('my_data_consent_ok') is not null and to_regproc('consent_doc_versions_no_delete') is not null and coalesce((select position('not in force yet' in prosrc) > 0 from pg_proc where proname = 'consent_doc_versions_keep_open' limit 1), false)), false)),
  ('0160_camp_self_signup применена', coalesce((to_regproc('camp_parent_register') is not null and to_regproc('camp_public') is not null and exists (select 1 from information_schema.columns where table_name = 'camps' and column_name = 'capacity') and to_regclass('camp_participant_events') is not null and to_regclass('camp_cancel_terms') is not null), false)),
  ('0161_camp_applications применена', coalesce((to_regclass('camp_applications') is not null and to_regproc('camp_apply') is not null and to_regproc('camp_application_decide') is not null and exists (select 1 from information_schema.columns where table_name = 'camp_participants' and column_name = 'owner_user_id')), false)),
  ('0162_consent_record применена', coalesce((to_regproc('accept_consent') is not null and to_regproc('revoke_parent_consent') is not null and exists (select 1 from pg_trigger where tgname = 'consent_links_lock' and not tgisinternal) and coalesce((select position('pg_advisory_xact_lock_shared' in prosrc) > 0 from pg_proc where proname = 'parental_consent_event_guard' limit 1), false)), false)),
  ('0169_camp_documents применена', coalesce((to_regclass('camp_documents') is not null and to_regproc('camp_document_begin') is not null and to_regproc('camp_document_finish') is not null and to_regproc('camp_document_path') is not null and (select count(*) = 2 from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('camp_documents_no_delete', 'camp_documents_no_truncate'))), false)),
  ('0170_camp_broadcasts применена', coalesce((to_regclass('camp_broadcasts') is not null and to_regproc('camp_broadcast_send') is not null and (select count(*) = 4 from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('camp_broadcasts_immutable', 'camp_broadcasts_no_truncate', 'camp_broadcast_messages_immutable', 'camp_broadcast_messages_no_truncate'))), false)),
  ('0173 ещё не применена (true = применять можно)', coalesce((to_regproc('parent_access_ok') is null), false))
) as t(check_name, ok)
order by check_name;
