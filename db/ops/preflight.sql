-- Состояние миграций 0001–0188 в текущей базе. Только чтение, ничего не меняет.
-- Статусы:
--   APPLIED     — текущее состояние миграции подтверждено, применять не нужно.
--   SUPERSEDED  — миграция заменена последующей, повторно применять не нужно.
--   NOT_APPLIED — нужного состояния нет; саму миграцию вслепую не запускать.
--   UNKNOWN     — по текущим объектам состояние достоверно определить нельзя.
-- Статус описывает текущее состояние объектов, а не историю выполнения миграции.
-- Не применяйте все NOT_APPLIED подряд: сначала проверьте зависимости и порядок миграций.
with m(migration, applied) as (values
  ('0001_init',                    coalesce((to_regclass('public.clubs') is not null and to_regclass('public.players') is not null and to_regclass('public.groups') is not null), false)),
  ('0002_rls',                     coalesce((to_regprocedure('public.is_admin()') is not null), false)),
  ('0003_legacy_domains',          coalesce((to_regclass('public.equipment_orders') is not null and to_regclass('public.payments') is not null), false)),
  ('0004_rls_legacy',              coalesce((to_regprocedure('public.is_coach_of_subscription(uuid)') is not null), false)),
  ('0005_players_fields',          coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'extras')), false)),
  ('0006_equipment_optional_date', coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'equipment_orders' and column_name = 'ordered_on' and is_nullable = 'YES')), false)),
  ('0007_tournaments',             coalesce((to_regclass('public.tournaments') is not null), false)),
  ('0008_individual',              coalesce((to_regclass('public.individual_sessions') is not null), false)),
  ('0009_schedule_training_log',   coalesce((to_regclass('public.training_log') is not null), false)),
  ('0010_camps_settings',          coalesce((to_regclass('public.camp_payments') is not null), false)),
  ('0011_attendance_import',       coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'source_key')), false)),
  ('0012_rating_rules',            coalesce((to_regclass('public.rules') is not null and to_regclass('public.point_events') is not null), false)),
  ('0013_groups_guardian_read',    coalesce((to_regprocedure('public.is_guardian_in_group(uuid)') is not null), false)),
  ('0014_link_requests',           coalesce((to_regclass('public.link_requests') is not null), false)),
  ('0015_consent',                 coalesce((to_regclass('public.consent_versions') is not null), false)),
  ('0016_rate_limits',             coalesce((to_regprocedure('public.rate_limit_hit(text,integer,integer)') is not null), false)),
  ('0017_link_cancel_retry',       coalesce((to_regprocedure('public.cancel_link(uuid)') is not null), false)),
  ('0018_coach_attendance',        coalesce((to_regprocedure('public.open_session(uuid,date)') is not null), false)),
  ('0019_coach_matches',           coalesce((to_regprocedure('public.save_match(uuid,uuid,date,text,integer,integer,jsonb)') is not null), false)),
  ('0020_coach_points_contacts',   coalesce((to_regprocedure('public.award_bonus(uuid,integer,text)') is not null), false)),
  ('0021_consent_coach_contacts',  coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consent_versions' and column_name = 'coach_contacts')), false)),
  ('0022_user_role',               coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'chosen_role')), false)),
  ('0023_prices_debt',             coalesce((to_regprocedure('public.debtors(date)') is not null), false)),
  ('0024_narrow_matches_schedule_read', coalesce((to_regprocedure('public.can_see_team(uuid,text)') is not null), false)),
  ('0025_consent_controls',        coalesce((to_regclass('public.data_requests') is not null), false)),
  ('0026_notifications',           coalesce((to_regclass('public.notifications') is not null), false)),
  ('0027_match_scoring_admin',     coalesce((to_regprocedure('public.delete_match(uuid)') is not null), false)),
  ('0028_child_access',            coalesce((to_regclass('public.child_codes') is not null), false)),
  ('0029_child_code_hardening',    coalesce((to_regprocedure('public.create_child_code(uuid)') is not null and pg_get_functiondef(to_regprocedure('public.create_child_code(uuid)')) like '%gen_random_uuid%'), false)),
  ('0030_revoke_trigger_function', coalesce((select not has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.notify_data_request()')), false)),
  ('0031_notifications_v2',        coalesce((to_regprocedure('public.enqueue_to_guardians(uuid,text,text)') is not null), false)),
  ('0032_debt_writeoff_month',     coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'written_off')), false)),
  ('0033_attendance_stats',        coalesce((to_regprocedure('public.attendance_stats(date,date)') is not null and to_regprocedure('public.match_stats(date,date,text)') is not null), false)),
  ('0034_individual_admin',        coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_sessions' and column_name = 'goalkeepers')), false)),
  ('0035_extra_sessions',          coalesce((to_regclass('public.extra_sessions') is not null), false)),
  ('0036_equipment_admin',         coalesce((to_regclass('public.equipment_issues') is not null), false)),
  ('0037_camps_admin',             coalesce((to_regprocedure('public.camp_save(uuid,text,text,date,date,numeric,date,date,boolean)') is not null), false)),
  ('0038_training_log_admin',      coalesce((to_regprocedure('public.tl_add(date,text,text,text,time,time,text,boolean)') is not null), false)),
  ('0039_bot_leads',               coalesce((to_regclass('public.lead_drafts') is not null), false)),
  ('0040_points_start',            coalesce((to_regprocedure('public.points_start()') is not null), false)),
  ('0041_match_tournament_labels', coalesce((to_regprocedure('public.match_tournaments()') is not null), false)),
  ('0042_coach_all_groups',        coalesce((to_regprocedure('public.trainer_attendance(date,date)') is not null), false)),
  ('0043_match_staff',             coalesce((to_regprocedure('public.trainer_stats(date,date)') is not null), false)),
  ('0044_lead_submit_app',         coalesce((to_regprocedure('public.lead_submit_app(text,text,integer,text,text,boolean)') is not null), false)),
  ('0045_booking_parents',         coalesce((to_regprocedure('public.booking_signup(text,uuid,uuid)') is not null), false)),
  ('0046_club_photos',             coalesce((to_regprocedure('public.club_photo_set(text,text)') is not null), false)),
  ('0047_ind_no_autobook',         coalesce((pg_get_functiondef(to_regprocedure('public.ind_create_session(date,time,boolean,text)')) not like '%individual_regulars%' or pg_get_functiondef(to_regprocedure('public.ind_create_session(date,time,boolean,text,time)')) not like '%individual_regulars%'), false)),
  ('0048_can_see_team_group_suffix', coalesce((pg_get_functiondef(to_regprocedure('public.can_see_team(uuid,text)')) like '%-[ABC]$%'), false)),
  ('0049_rename_u12_match_team',   coalesce((not exists (select 1 from matches m where m.team = 'U12' and exists (select 1 from groups g where g.club_id = m.club_id and g.name = 'Ortachala U12'))), false)),
  ('0050_ind_goalkeepers_backfill', coalesce((not exists (select 1 from individual_sessions where external_id like '%-GK' and not goalkeepers)), false)),
  ('0051_events',                  coalesce((to_regprocedure('public.event_create(text,text,text,date,numeric,uuid)') is not null), false)),
  ('0052_ind_change_type',         coalesce((pg_get_functiondef(to_regprocedure('public.ind_edit_session(uuid,date,time,text,boolean)')) like '%goalkeepers = new_gk%' or pg_get_functiondef(to_regprocedure('public.ind_edit_session(uuid,date,time,text,boolean,time)')) like '%goalkeepers = new_gk%'), false)),
  ('0053_event_fees',              coalesce((to_regprocedure('public.event_pay(uuid,uuid[],numeric,date,text,text)') is not null), false)),
  ('0054_match_fees',              coalesce((to_regprocedure('public.match_pay(uuid,uuid[],numeric,date,text,text)') is not null), false)),
  ('0055_match_team_base_name',    coalesce((pg_get_functiondef(to_regprocedure('public.save_match(uuid,uuid,date,text,integer,integer,jsonb)')) like '%regexp_replace%'), false)),
  ('0056_coach_ind_marks',         coalesce((to_regprocedure('public.ind_roster_list(date,date)') is not null), false)),
  ('0057_coach_extra_marks',       coalesce((to_regprocedure('public.extra_roster_list(date,date)') is not null), false)),
  ('0058_parent_dues',             coalesce((to_regprocedure('public.parent_dues()') is not null), false)),
  ('0059_payment_for_month',       coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'pay_month')), false)),
  ('0060_event_roster_stats_kind', coalesce((to_regprocedure('public.match_stats(date,date,text)') is not null), false)),
  ('0061_coach_match_fees',       coalesce((to_regprocedure('public.match_assert_fees(uuid)') is not null), false)),
  ('0062_tl_edit_session',         coalesce((to_regprocedure('public.tl_edit_session(date,text,time,time,time,text)') is not null), false)),
  ('0063_parent_tournaments',      coalesce((to_regprocedure('public.my_tournaments()') is not null), false)),
  ('0064_parent_calendar',         coalesce((to_regprocedure('public.parent_calendar(uuid,date,date)') is not null), false)),
  ('0065_link_search_rate_limit',  coalesce((pg_get_functiondef(to_regprocedure('public.search_players_for_link(text)')) like '%link_search%'), false)),
  ('0066_link_flood_limits',       coalesce((to_regclass('public.link_notify_log') is not null), false)),
  ('0067_export_points_start',     coalesce((pg_get_functiondef(to_regprocedure('public.export_my_data()')) like '%points_start%' or pg_get_functiondef(to_regprocedure('public.export_my_data()')) like '%points_ledger%'), false)),
  ('0068_notify_bonus_points_start', coalesce((pg_get_functiondef(to_regprocedure('public.notify_bonus()')) like '%points_start%'), false)),
  ('0069_booking_cancel_started',  coalesce((pg_get_functiondef(to_regprocedure('public.booking_cancel(text,uuid,uuid)')) like '%session already started%'), false)),
  ('0076_event_roster_remove_paid', coalesce((pg_get_functiondef(to_regprocedure('public.event_roster_remove(uuid,uuid)')) like '%tournament_fees where tournament_id = t and player_id = pid and paid%'), false)),
  ('0070_extra_session_time',      coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'extra_sessions' and column_name = 'starts_time')), false)),
  ('0071_imported_paid_materialize', coalesce((pg_get_functiondef(to_regprocedure('public.event_pay(uuid,uuid[],numeric,date,text,text)')) like '%Оплата из импорта%'), false)),
  ('0072_pay_dedupe_ids',          coalesce((pg_get_functiondef(to_regprocedure('public.event_pay(uuid,uuid[],numeric,date,text,text)')) like '%uids%'), false)),
  ('0073_extra_paid_amount_check', coalesce((select bool_or(position('bad amount' in prosrc) > 0) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'extra_set_paid'), false)),
  ('0074_camp_participant_amount_floor', coalesce((pg_get_functiondef(to_regprocedure('public.camp_update_participant(uuid,uuid,numeric,text,text,text)')) like '%amount below paid%'), false)),
  ('0075_booking_board_extra_time', coalesce((pg_get_functiondef(to_regprocedure('public.booking_board()')) like '%starts_time%'), false)),
  ('0077_payment_author',          coalesce((exists (select 1 from pg_trigger where tgname = 'payments_stamp_author' and not tgisinternal)), false)),
  ('0078_cash_report',             coalesce((to_regprocedure('public.cash_report(date,date,text,uuid,text)') is not null), false)),
  ('0079_training_log_coach_read', coalesce((exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'training_log' and policyname = 'training_log_coach_read')), false)),
  ('0080_stats_own_groups',        coalesce((pg_get_functiondef(to_regprocedure('public.match_stats(date,date,text)')) like '%with mine as%' and pg_get_functiondef(to_regprocedure('public.attendance_stats(date,date)')) like '%adm or s.group_id%'), false)),
  ('0081_match_stats_drop_old_overload', coalesce((to_regprocedure('public.match_stats(date,date)') is null), false)),
  ('0082_match_stats_category_coach', coalesce((pg_get_functiondef(to_regprocedure('public.match_stats(date,date,text)')) like '%tournament_label%'), false)),
  ('0083_service_payments',        coalesce((to_regclass('public.service_payments') is not null and to_regprocedure('public.service_payment_add(text,uuid,uuid,numeric,date,text,uuid)') is not null), false)),
  ('0084_cash_report_service',     coalesce((pg_get_functiondef(to_regprocedure('public.cash_report(date,date,text,uuid,text)')) like '%service_payments%'), false)),
  ('0085_location_admins',         coalesce((to_regclass('public.location_admins') is not null and to_regprocedure('public.is_location_admin(text)') is not null), false)),
  ('0086_cash_day_service',        coalesce(to_regprocedure('public.cash_day_service(date)') is not null, false)),
  ('0087_link_search_volatile',    coalesce((select provolatile = 'v' from pg_proc where oid = to_regprocedure('public.search_players_for_link(text)')), false)),
  ('0088_booking_board_ends_at',   coalesce((pg_get_functiondef(to_regprocedure('public.booking_board()')) like '%ends_time%'), false)),
  ('0089_user_club',               coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'club_id')), false)),
  ('0090_ind_autocreate',          coalesce((to_regclass('public.individual_templates') is not null and to_regprocedure('public.ind_autocreate(date)') is not null and to_regprocedure('public.ind_slot_member_set(uuid,uuid,date,boolean)') is not null), false)),
  -- 0091 перекрыта 0094 (event_list снова считает только tournament_fees), поэтому проверка на match_players стала ложной: смотрим только на наличие функции
  ('0091_event_list_players_count', coalesce((to_regprocedure('public.event_list()') is not null), false)),
  ('0092_ind_autocreate_window',   coalesce((pg_get_functiondef(to_regprocedure('public.ind_autocreate(date)')) like '%generate_series%'), false)),
  ('0093_discount_without_payment', coalesce((pg_get_functiondef(to_regprocedure('public.debtors(date)')) not like '%pm.amt, 0) > 0)%'), false)),
  ('0094_event_roster_championship_only', coalesce((pg_get_functiondef(to_regprocedure('public.event_roster(uuid)')) not like '%match_players%'), false)),
  ('0095_cash_day_service_time',   coalesce((pg_get_functiondef(to_regprocedure('public.cash_day_service(date)')) like '%''recorded_at''%'), false)),
  ('0096_consent_lawyer_2026_11',  coalesce((exists (select 1 from consent_versions where version = 'lawyer-2026-11-v1')), false)),
  ('0097_payment_cancels',         coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'cancels')), false)),
  ('0098_equipment_order_status',  coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'equipment_orders' and column_name = 'status')), false)),
  ('0099_payment_info',            coalesce((exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'payment_info')), false)),
  ('0100_debt_closure_reason',     coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'closed_kind')), false)),
  ('0101_camp_guests',             coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'camp_participants' and column_name = 'guest_name')), false)),
  ('0102_extra_cap_number_info',   coalesce((to_regprocedure('public.extra_cap(uuid)') is not null), false)),
  ('0103_event_status',            coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tournaments' and column_name = 'status')), false)),
  ('0104_player_status_pause',     coalesce((to_regclass('public.player_status_log') is not null), false)),
  ('0105_paused_months_not_due',   coalesce((to_regproc('public.player_paused_month') is not null), false)),
  ('0106_friendly_match_without_group', coalesce((to_regproc('public.save_match_team') is not null), false)),
  ('0107_equipment_status_backfill', coalesce((to_regprocedure('public.eq_order_fully_issued(uuid)') is not null), false)),
  ('0108_location_admin_equipment_issue', coalesce((exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipment_issues' and policyname = 'equipment_issues_location_read')), false)),
  ('0109_fee_discount_reason',     coalesce((to_regclass('public.fee_discount_log') is not null and to_regprocedure('public.event_discount(uuid,uuid,numeric,text)') is not null and to_regprocedure('public.match_discount(uuid,uuid,numeric,text)') is not null), false)),
  ('0110_location_admin_report_own', coalesce((pg_get_functiondef(to_regprocedure('public.cash_report(date,date,text,uuid,text)')) like '%recorded_by = current_user_id()%'), false)),
  ('0111_club_articles',           coalesce((to_regclass('public.club_articles') is not null and to_regproc('public.club_article_save') is not null and exists (select 1 from pg_trigger where tgname = 'club_articles_stamp' and not tgisinternal)), false)),
  ('0112_lead_not_for_child',      coalesce((pg_get_functiondef(to_regprocedure('public.lead_submit_app(text,text,integer,text,text,boolean)')) like '%child_links%'), false)),
  ('0113_club_articles_admin_only', coalesce((pg_get_functiondef(to_regproc('public.club_article_save')) not like '%is_any_coach%'), false)),
  ('0114_club_article_sections',   coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'club_articles' and column_name = 'section')), false)),
  ('0115_parent_first_attendance', coalesce((to_regprocedure('public.parent_first_attendance(uuid)') is not null), false)),
  ('0116_parent_calendar_no_dup_log', coalesce((pg_get_functiondef(to_regprocedure('public.parent_calendar(uuid,date,date)')) like '%distinct on (tl.held_on%'), false)),
  ('0117_points_rule_versions',    coalesce((to_regclass('public.points_rule_versions') is not null and to_regproc('public.points_rules_save') is not null), false)),
  ('0118_points_ledger',           coalesce((to_regclass('public.points_ledger') is not null and to_regclass('public.points_ledger_audit') is not null and to_regproc('public.points_ledger_apply') is not null), false)),
  ('0119_settings_defaults', coalesce((pg_get_functiondef(to_regprocedure('public.ind_cap(uuid,boolean)')) like '%then 7 else 6%'), false)),
  ('0120_session_class_group_history', coalesce((to_regclass('public.player_group_history') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'class') and to_regproc('public.open_session_special') is not null), false)),
  ('0121_points_for_training', coalesce((to_regproc('public.points_reconcile_group_session') is not null and exists (select 1 from pg_trigger where tgname = 'points_attendance_sync' and not tgisinternal) and (pg_get_functiondef(to_regprocedure('public.mark_attendance(uuid,jsonb)')) like '%roster incomplete%')), false)),
  ('0122_points_for_matches', coalesce((to_regproc('public.points_reconcile_match') is not null and to_regclass('public.match_revisions') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'matches' and column_name = 'technical') and to_regproc('public.set_match_technical') is not null), false)),
  ('0123_points_manual', coalesce((to_regproc('public.points_manual_award') is not null and to_regproc('public.points_manual_cancel') is not null and to_regproc('public.points_manual_status') is not null), false)),
  ('0124_points_series', coalesce((to_regproc('public.points_reconcile_series') is not null and to_regproc('public.points_series_info') is not null and exists (select 1 from pg_trigger where tgname = 'points_series_attendance_sync' and not tgisinternal)), false)),
  ('0125_equipment_order_edit_lines', coalesce((to_regprocedure('public.eq_edit_line(uuid,text,integer)') is not null and to_regprocedure('public.eq_add_line(uuid,text,text,integer)') is not null and to_regprocedure('public.eq_delete_line(uuid)') is not null and to_regprocedure('public.eq_set_order_date(uuid,date)') is not null), false)),
  ('0126_points_group_benchmark', coalesce((to_regproc('public.points_group_benchmark') is not null), false)),
  ('0127_points_consistency', coalesce((to_regproc('public.points_consistency') is not null), false)),
  ('0128_subscription_month_auto', coalesce((to_regproc('public.subscription_month_auto') is not null and to_regproc('public.subscription_month_missing') is not null), false)),
  ('0129_points_test_mode', coalesce((to_regproc('public.points_consistency_run') is not null), false)),
  ('0130_notify_points_ledger', coalesce((to_regproc('public.notify_points_ledger') is not null), false)),
  ('0131_points_exceptions_floor', coalesce((select position('floor_day' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.points_consistency_run(boolean)')), false)),
  ('0132_equipment_status_auto_issued', coalesce((exists (select 1 from pg_trigger where tgname = 'equipment_issues_sync_status' and not tgisinternal)), false)),
  ('0133_equipment_status_follows_lines', coalesce((exists (select 1 from pg_trigger where tgname = 'equipment_lines_sync_status' and not tgisinternal)), false)),
  ('0134_match_rsvp_base', coalesce((to_regclass('public.match_invitations') is not null and to_regproc('public.match_rsvp_publish') is not null), false)),
  ('0135_points_benchmark_place', coalesce((select position('''place''' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.points_group_benchmark(uuid,date)')), false)),
  ('0136_match_rsvp_reschedule_marks', coalesce((to_regclass('public.match_mark_snapshots') is not null), false)),
  ('0137_match_rsvp_notifications', coalesce((to_regproc('public.rsvp_auto_reminders') is not null and to_regproc('public.rsvp_answer_by_telegram') is not null), false)),
  ('0138_extra_cap_validation', coalesce((pg_get_functiondef(to_regprocedure('public.extra_cap(uuid)')) like '%invalid setting extra.cap%'), false)),
  ('0139_match_rsvp_change_notices', coalesce((to_regproc('public.rsvp_notify_players') is not null), false)),
  ('0140_match_rsvp_reminder_window', coalesce((select position('25 hours' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.rsvp_auto_reminders()')), false)),
  ('0141_booking_integrity', coalesce((to_regproc('public.ind_regulars_overflow') is not null), false)),
  ('0142_extra_sessions_model', coalesce((to_regproc('public.extra_cancel_session') is not null), false)),
  ('0143_regulars_overflow_active_only', coalesce((select position('p.status' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.ind_regulars_overflow(date)')), false)),
  ('0144_notification_directions', coalesce((to_regproc('public.notify_pref_set') is not null), false)),
  ('0145_booking_cancellations', coalesce((to_regproc('public.booking_cancel_refund') is not null), false)),
  ('0146_extra_targets', coalesce((to_regproc('public.extra_target_group') is not null), false)),
  ('0148_booking_notifications', coalesce((to_regproc('public.booking_family_notice') is not null), false)),
  ('0149_booking_waitlist', coalesce((to_regproc('public.waitlist_claim') is not null), false)),
  ('0150_individual_times', coalesce((to_regproc('public.booking_conflicts') is not null), false)),
  ('0151_first_wave', coalesce((to_regproc('public.first_wave_friday') is not null), false)),
  ('0152_waitlist_bot_button', coalesce((to_regproc('public.waitlist_claim_by_telegram') is not null), false)),
  ('0153_champ_guest_match_fee', coalesce((to_regproc('public.guest_match_fee') is not null), false)),
  ('0155_champ_guest_covered_elsewhere', coalesce((to_regproc('public.champ_guest_ids') is not null), false)),
  ('0154_cash_find_players', coalesce((to_regproc('public.cash_find_players') is not null), false)),
  ('0156_cash_day_match_event_payments', coalesce((select position('match_payments' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.cash_day_service(date)')), false)),
  ('0157_eq_add_payment_date_guard', coalesce((select bool_and(position('bad date' in prosrc) > 0) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'eq_add_payment'), false)), -- с 0188 у функции пятый параметр (request_id), поэтому проверяется по имени
  ('0147_status_log_read_any_coach', coalesce((exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'player_status_log' and policyname = 'player_status_log_read' and qual like '%is_any_coach%')), false)),
  ('0158_booking_telegram', coalesce((to_regproc('public.booking_signup_by_telegram') is not null and to_regproc('public.waitlist_join_by_telegram') is not null and to_regproc('public.booking_options_by_telegram') is not null), false)),
  ('0159_consent_model', coalesce((to_regclass('public.parental_consents') is not null and to_regclass('public.parental_consent_events') is not null and to_regclass('public.consent_doc_versions') is not null and to_regproc('public.my_data_consent_ok') is not null and to_regproc('public.consent_doc_versions_no_delete') is not null and coalesce((select position('not in force yet' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.consent_doc_versions_keep_open()')), false)), false)),
  ('0160_camp_self_signup', coalesce((to_regproc('public.camp_parent_register') is not null and to_regproc('public.camp_public') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'camps' and column_name = 'capacity') and to_regclass('public.camp_participant_events') is not null and to_regclass('public.camp_cancel_terms') is not null), false)),
  ('0161_camp_applications', coalesce((to_regclass('public.camp_applications') is not null and to_regproc('public.camp_apply') is not null and to_regproc('public.camp_application_decide') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'camp_participants' and column_name = 'owner_user_id')), false)),
  ('0162_consent_record', coalesce((to_regproc('public.accept_consent') is not null and to_regproc('public.revoke_parent_consent') is not null and exists (select 1 from pg_trigger where tgname = 'consent_links_lock' and not tgisinternal) and coalesce((select position('pg_advisory_xact_lock_shared' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.parental_consent_event_guard()')), false)), false)),
  ('0173_consent_access', coalesce((to_regprocedure('public.parent_access_ok(uuid,uuid)') is not null and to_regclass('public.consent_test_parents') is not null and exists (select 1 from pg_trigger where tgname = 'consent_mode_guard' and not tgisinternal) and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consent_doc_versions' and column_name = 'coach_contacts')), false)),
  ('0178_guest_visits', coalesce((to_regclass('public.session_guests') is not null and to_regproc('public.session_guest_add') is not null and to_regproc('public.session_guest_set_paid') is not null and to_regproc('public.session_guest_remove') is not null and to_regproc('public.guest_visit_fee') is not null and exists (select 1 from pg_trigger where tgname = 'points_session_guests_sync' and not tgisinternal) and coalesce((select position('session_guests' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.points_reconcile_group_session(uuid)')), false) and coalesce((select position('Разовое посещение' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.cash_report(date,date,text,uuid,text)')), false) and coalesce((select position('Разовое посещение' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.cash_day_service(date)')), false) and coalesce((select position('session_guests' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.parent_calendar(uuid,date,date)')), false) and coalesce((select position('session_guests' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.parent_dues()')), false)), false)),
  ('0175_consent_camp_broadcast_audience', (exists (select 1 from pg_proc where oid = to_regprocedure('public.camp_broadcast_audience(uuid,text,text)') and prosrc like '%parent_access_ok%') and exists (select 1 from pg_proc where oid = to_regprocedure('public.camp_broadcast_targets(uuid,text,text)') and prosrc like '%camp_broadcast_audience%'))),
  ('0165_camp_history_immutable', coalesce((select count(*) = 5 from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('camp_payments_immutable', 'camp_payments_no_truncate', 'camp_payments_insert_guard', 'camp_participants_no_delete', 'camp_participants_no_truncate')) and coalesce((select not has_table_privilege('authenticated', c.oid, 'delete') and not has_table_privilege('service_role', c.oid, 'update') from pg_class c where c.oid = to_regclass('public.camp_payments')), false) and coalesce((select not has_table_privilege('authenticated', c.oid, 'update') from pg_class c where c.oid = to_regclass('public.camp_tariffs')), false), false)),
  ('0166_camp_edit_cancel', coalesce((to_regproc('public.camp_parent_update') is not null and to_regproc('public.camp_parent_cancel') is not null and to_regproc('public.camp_refund') is not null and to_regclass('public.camp_participant_replacements') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'camp_participant_events' and column_name = 'terms_text') and (select count(*) = 2 from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('camp_participant_replacements_no_change', 'camp_participant_replacements_no_truncate')) and exists (select 1 from pg_trigger t join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any(t.tgattr) where t.tgname = 'camp_participants_log' and a.attname = 'amount')), false)),
  ('0167_camp_notifications', coalesce((to_regproc('public.camp_notify_enabled') is not null and (select count(*) = 2 from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('camp_participant_events_notify', 'camp_applications_notify'))), false)),
  ('0168_match_duration_setting', coalesce((select has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.match_duration_minutes()')), false)),
  ('0169_camp_documents', coalesce((to_regclass('public.camp_documents') is not null and to_regproc('public.camp_document_begin') is not null and to_regproc('public.camp_document_finish') is not null and to_regproc('public.camp_document_path') is not null and (select count(*) = 2 from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('camp_documents_no_delete', 'camp_documents_no_truncate'))), false)),
  ('0170_camp_broadcasts', coalesce((to_regclass('public.camp_broadcasts') is not null and to_regproc('public.camp_broadcast_send') is not null and (select count(*) = 4 from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('camp_broadcasts_immutable', 'camp_broadcasts_no_truncate', 'camp_broadcast_messages_immutable', 'camp_broadcast_messages_no_truncate'))), false)),
  ('0171_individual_template_admin', coalesce((select not has_table_privilege('authenticated', c.oid, 'delete') and has_table_privilege('authenticated', c.oid, 'insert') and has_table_privilege('authenticated', c.oid, 'update') from pg_class c where c.oid = to_regclass('public.individual_templates')), false)),
  ('0172_camp_broadcast_audience', coalesce((to_regproc('public.camp_broadcast_audience') is not null and to_regproc('public.camp_broadcast_recipients') is not null), false)),
  ('0174_booking_cancel_notice', coalesce((pg_get_functiondef(to_regprocedure('public.booking_cancel(text,uuid,uuid)')) like '%Отмена записи на занятие%' and pg_get_functiondef(to_regprocedure('public.booking_signup(text,uuid,uuid)')) not like '%Индивидуальные / Дополнительные%'), false)),
  ('0176_consent_claim_check', (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'player_ids') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'consent_check_attempts') and exists (select 1 from pg_proc where oid = to_regprocedure('public.claim_notifications(integer)') and position('parent_access_ok' in prosrc) > 0) and to_regprocedure('public.camp_broadcast_player_ids(uuid,uuid)') is not null)),
  ('0177_ind_autocreate_topic_offset', coalesce((position($$/ 7 + 2) % array_length$$ in pg_get_functiondef(to_regprocedure('public.ind_autocreate(date)'))) > 0), false)),
  ('0179_payment_history_guard', coalesce((
    (select count(*) = 16 from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in (
      'payments_history_guard', 'payments_history_no_truncate', 'payments_history_audit',
      'match_payments_history_guard', 'match_payments_history_no_truncate', 'match_payments_history_audit',
      'tournament_payments_history_guard', 'tournament_payments_history_no_truncate', 'tournament_payments_history_audit',
      'service_payments_history_guard', 'service_payments_history_no_truncate', 'service_payments_history_audit',
      'subscriptions_closed_no_delete', 'players_delete_audit', 'match_fees_player_cascade_guard', 'tournament_fees_player_cascade_guard'))
    and to_regprocedure('public.payment_history_guard()') is not null
    and to_regprocedure('public.payment_history_audit()') is not null
    and to_regprocedure('public.subscription_closure_guard()') is not null
    and to_regprocedure('public.player_delete_audit()') is not null
    and to_regprocedure('public.fee_player_cascade_guard()') is not null
    and coalesce((select not has_table_privilege('authenticated', c.oid, 'delete') from pg_class c where c.oid = to_regclass('public.players')), false)
  ), false)),
  ('0180_function_acl', coalesce((
    select bool_and(case when to_regprocedure('public.' || s) is null then false
                         else not has_function_privilege('anon', to_regprocedure('public.' || s), 'execute') end)
    from unnest(array['apply_match_points(uuid)', 'award_bonus(uuid,integer,text)', 'cancel_link(uuid)', 'debt_start()', 'debtors(date)', 'decide_link(uuid,boolean)', 'delete_match(uuid)', 'erase_parent(uuid)', 'export_my_data()', 'group_parents(uuid)', 'mark_attendance(uuid,jsonb)', 'open_session(uuid,date)', 'parent_debts()', 'recalc_match_points(uuid)', 'reject_data_request(uuid,text)', 'request_data_deletion()', 'request_link(uuid,text)', 'retry_link(uuid)', 'revoke_bonus(uuid)', 'revoke_consent(uuid)', 'rule_for(uuid,text,date)', 'save_match(uuid,uuid,date,text,integer,integer,jsonb)', 'search_players_for_link(text)', 'tariff_for(uuid,uuid,date)', 'tbilisi_day(timestamptz)']) s
  ) and (
    select bool_and(case when to_regprocedure('public.' || s) is null then false
                         else not has_function_privilege('authenticated', to_regprocedure('public.' || s), 'execute') end)
    from unnest(array['apply_match_points(uuid)', 'debt_start()', 'points_rules_for(uuid,date)', 'rule_for(uuid,text,date)', 'tariff_for(uuid,uuid,date)']) s
  ), false)),
  ('0181_roster_on_date', coalesce((to_regprocedure('public.points_player_on_roster(uuid,date)') is not null and position('points_player_on_roster' in pg_get_functiondef(to_regprocedure('public.mark_attendance(uuid,jsonb)'))) > 0), false)),
  ('0184_notifications_queue_stall', coalesce((to_regprocedure('public.release_notifications(uuid[],uuid)') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'claim_token') and exists (select 1 from pg_proc where oid = to_regprocedure('public.claim_notifications(integer)') and position('stalled' in prosrc) > 0 and position('parent_access_ok' in prosrc) > 0)), false)),
  ('0185_equipment_order_foundation', coalesce((to_regclass('public.equipment_order_events') is not null and to_regprocedure('public.eq_cancel_order(uuid,text)') is not null and to_regprocedure('public.eq_restore_order(uuid,text)') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'equipment_orders' and column_name = 'status_before_cancel') and (select count(*) = 5 from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('equipment_orders_guard', 'equipment_lines_cancelled_freeze', 'equipment_issues_cancelled_freeze', 'equipment_order_events_immutable', 'equipment_order_events_no_truncate'))), false)),
  ('0186_points_legacy_off', coalesce((exists (select 1 from pg_trigger where tgrelid = 'public.point_events'::regclass and tgname = 'point_events_archive_freeze' and not tgisinternal) and not exists (select 1 from pg_trigger where tgrelid = 'public.point_events'::regclass and tgname = 'point_events_notify') and to_regprocedure('public.save_match_tech(uuid,uuid,text,date,text,integer,integer,jsonb,boolean)') is not null and not coalesce((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.oid = to_regprocedure('public.award_bonus(uuid,integer,text)')), true) and position('points_ledger' in pg_get_functiondef(to_regprocedure('public.export_my_data()'))) > 0), false)),
  ('0188_equipment_payment_journal', coalesce((exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'service_payments' and column_name = 'op') and to_regprocedure('public.eq_reverse_payment(uuid,text,uuid)') is not null and to_regprocedure('public.eq_refund(uuid,numeric,date,text,text,uuid)') is not null and to_regprocedure('public.eq_add_payment(uuid,numeric,date,text,uuid)') is not null and (select count(*) = 4 from pg_trigger where tgrelid = 'public.service_payments'::regclass and not tgisinternal and tgenabled = 'O' and tgname in ('service_payments_insert_guard', 'service_payments_paid_sync', 'service_payments_history_guard', 'service_payments_history_audit')) and not has_table_privilege('service_role', 'public.service_payments', 'insert') and not has_table_privilege('authenticated', 'public.equipment_orders', 'update')), false))
),
overrides(migration, status) as (
  select '0047_ind_no_autobook', case
    when not coalesce((select applied from m where migration = '0047_ind_no_autobook'), false) then 'NOT_APPLIED'
    when to_regprocedure('public.ind_create_session(date,time,boolean,text)') is not null then 'APPLIED'
    when to_regprocedure('public.ind_create_session(date,time,boolean,text,time)') is not null then 'SUPERSEDED'
    else 'NOT_APPLIED'
  end
  union all select '0052_ind_change_type', case
    when not coalesce((select applied from m where migration = '0052_ind_change_type'), false) then 'NOT_APPLIED'
    when to_regprocedure('public.ind_edit_session(uuid,date,time,text,boolean)') is not null then 'APPLIED'
    when to_regprocedure('public.ind_edit_session(uuid,date,time,text,boolean,time)') is not null then 'SUPERSEDED'
    else 'NOT_APPLIED'
  end
  union all select '0081_match_stats_drop_old_overload', case
    when to_regprocedure('public.match_stats(date,date)') is not null then 'NOT_APPLIED'
    when to_regprocedure('public.match_stats(date,date,text)') is not null then 'SUPERSEDED'
    else 'NOT_APPLIED'
  end
  union all select '0091_event_list_players_count', case
    when to_regprocedure('public.match_stats(date,date,text)') is not null
     and to_regprocedure('public.event_roster(uuid)') is not null
     and coalesce(pg_get_functiondef(to_regprocedure('public.event_roster(uuid)')) not like '%match_players%', false) then 'SUPERSEDED'
    when coalesce((select applied from m where migration = '0091_event_list_players_count'), false) then 'APPLIED'
    else 'NOT_APPLIED'
  end
  union all select '0173_consent_access', case
    when not coalesce((select applied from m where migration = '0173_consent_access'), false) then 'NOT_APPLIED'
    when not (
      coalesce((select prosrc like '%consent_revoked_at%' from pg_proc where oid = to_regprocedure('public.parent_access_ok(uuid,uuid)')), false)
      and coalesce((select prosrc like '%consent_revoked_at%' from pg_proc where oid = to_regprocedure('public.decide_link(uuid,boolean)')), false)
      and coalesce((select prosrc like '%consent_revoked_at%' from pg_proc where oid = to_regprocedure('public.revoke_consent(uuid)')), false)
      and coalesce((select prosrc like '%consent_revoked_at%' from pg_proc where oid = to_regprocedure('public.export_my_data()')), false)
    ) then 'NOT_APPLIED'
    when exists (
      select 1 from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.prosrc like '%consent_revoked_at%'
        and p.oid not in (
          to_regprocedure('public.parent_access_ok(uuid,uuid)')::oid,
          to_regprocedure('public.decide_link(uuid,boolean)')::oid,
          to_regprocedure('public.revoke_consent(uuid)')::oid,
          to_regprocedure('public.export_my_data()')::oid
        )
    ) then 'UNKNOWN'
    else 'APPLIED'
  end
),
st(migration, status) as (
  select m.migration, coalesce(o.status, case when m.applied then 'APPLIED' else 'NOT_APPLIED' end)
  from m left join overrides o on o.migration = m.migration
)
-- note для 0176 (требует 0173 и 0175): applied | ready | blocked: ... | inconsistent: ... | ambiguous: ... | unknown: ... (NULL не приводится к false).
select m.migration,
       m.applied,
       st.status,
  case when m.migration = '0176_consent_claim_check' then
    (select case
       when p73 is null or p75 is null or m.applied is null then 'unknown: признак 0173, 0175 или 0176 не определён (NULL)'
       when s176 not in (0, 4) then 'ambiguous: 0176 применена частично (' || s176 || ' из 4 признаков), не применять, разобрать вручную'
       when m.applied and p73 and p75 then 'applied'
       when m.applied then 'inconsistent: 0176 есть, но нет ' || case when not p73 and not p75 then '0173 и 0175' when not p73 then '0173' else '0175' end || ' (не применять заново, разобрать вручную)'
       when p73 and p75 then 'ready: 0173 и 0175 применены, 0176 можно применять'
       else 'blocked: применять нельзя, сначала ' || case when not p73 and not p75 then '0173, затем 0175' when not p73 then '0173' else '0175' end
     end
     from (select (select s2.status = 'APPLIED' from st s2 where s2.migration = '0173_consent_access') as p73,
                  (select s2.status = 'APPLIED' from st s2 where s2.migration = '0175_consent_camp_broadcast_audience') as p75,
                  (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'player_ids'))::int
                  + (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'consent_check_attempts'))::int
                  + (exists (select 1 from pg_proc where oid = to_regprocedure('public.claim_notifications(integer)') and position('parent_access_ok' in prosrc) > 0))::int
                  + (to_regprocedure('public.camp_broadcast_player_ids(uuid,uuid)') is not null)::int as s176) pre)
  end as note
from m
join st on st.migration = m.migration
order by m.migration;
