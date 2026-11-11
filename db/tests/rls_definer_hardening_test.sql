-- pgTAP: функции security definer — путь поиска закреплён, служебные функции закрыты, набор вызываемых
-- функций известен. Новая функция в схеме public без явного решения роняет этот тест (добавьте её в список
-- ниже, если она должна вызываться из приложения, или отзовите права).
begin;
create extension if not exists pgtap;
select plan(5);

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  '', 'у каждой security definer функции задан search_path');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
      and p.proname not in ('group_rating', 'is_admin', 'is_coach_of_group', 'is_coach_of_player', 'is_coach_of_subscription', 'is_guardian_in_group', 'is_guardian_of',
      -- 0160: публичные данные сбора без входа (без участников и персональных данных)
      'camp_public')),
  '', 'гостю (anon) доступны только проверочные функции без данных');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('apply_match_points', 'claim_notifications', 'enqueue_notification', 'enqueue_to_admins', 'enqueue_to_guardians', 'notify_coach_group', 'notify_payment', 'notify_bonus', 'lead_submit', 'has_consent', 'consent_record', 'consent_on_link_delete', 'consent_versions_lock', 'consent_links_lock', 'ind_book', 'ind_assert_admin', 'ind_price', 'ind_cap', 'extra_cap', 'eq_assert_admin', 'eq_number_taken', 'eq_price', 'camp_assert_admin', 'camp_participants_log', 'camp_participants_seat_guard', 'camp_assert_seat', 'camp_terms_for', 'camp_participant_mine', 'camp_notify_enabled', 'camp_enqueue_admins', 'camp_notify_event', 'camp_notify_application', 'camps_capacity_guard', 'tl_assert_admin', 'finish_notification', 'notify_link_request', 'notify_data_request', 'rate_limit_hit', 'rule_for', 'tariff_for', 'rsvp_assert_staff', 'rsvp_lock_match', 'rsvp_log', 'rsvp_claim_reminder', 'rsvp_notify_parent', 'rsvp_notify_match', 'rsvp_matches_notify', 'rsvp_invitation_notify', 'rsvp_auto_reminders', 'rsvp_answer_by_telegram', 'rsvp_notify_players', 'rsvp_invitations_stage', 'rsvp_notice_flush', 'rsvp_matches_details_notify', 'extra_log', 'extra_session_cap', 'notify_pref_default', 'notify_direction_enabled', 'enqueue_direction_notification', 'booking_cancellation_assert', 'extra_eligible', 'extra_recipients', 'booking_notify_enabled', 'booking_when', 'booking_session_label', 'booking_notice_once', 'booking_family_notice', 'waitlist_state', 'waitlist_notify', 'waitlist_trg_freed', 'waitlist_trg_booked', 'waitlist_trg_ind_session', 'waitlist_trg_extra_session', 'first_wave_has_booking', 'waitlist_claim_by_telegram')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  '', 'служебные функции недоступны из приложения');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname not in (
        'award_bonus', 'booking_info_pending', 'booking_info_seen', 'first_wave_add', 'first_wave_friday', 'first_wave_list', 'first_wave_remove', 'booking_conflicts', 'waitlist_board', 'waitlist_claim', 'waitlist_join', 'waitlist_leave', 'waitlist_session', 'can_see_team', 'champ_guest_ids', 'cancel_link', 'child_linked', 'create_child_code', 'debtors', 'decide_link', 'delete_match',
        'erase_parent', 'export_my_data', 'group_parents', 'group_rating', 'is_admin', 'is_coach_of_group', 'is_coach_of_player',
        'is_coach_of_subscription', 'is_guardian_in_group', 'is_guardian_of', 'is_self_player', 'mark_attendance', 'open_session',
        'parent_calendar', 'parent_first_attendance', 'parent_debts', 'recalc_match_points', 'redeem_child_code', 'reject_data_request', 'request_data_deletion', 'request_link',
        'retry_link', 'revoke_bonus', 'revoke_consent', 'save_match', 'search_players_for_link', 'set_my_role', 'set_notifications', 'notify_prefs_get', 'notify_pref_set', 'extra_target_group', 'extra_target_player', 'extra_ineligible', 'booking_cancel_keep', 'booking_cancel_refund', 'booking_cancel_transfer', 'booking_transfer_targets',
        'unlink_child',
        -- функции администратора из следующих миграций (0032–0039): внутри каждой проверяется is_admin()
        'create_subscription_month', 'subscription_month_missing', 'ind_create_session', 'ind_add_player', 'ind_set_paid', 'ind_remove_player', 'ind_edit_session', 'ind_delete_session',
        'ind_set_regular', 'ind_autocreate_now', 'ind_slot_member_set', 'ind_regulars_overflow', 'ind_set_attended', 'extra_create_session', 'extra_edit_session', 'extra_delete_session', 'extra_add_player', 'extra_remove_player',
        'extra_set_paid', 'extra_set_attended', 'extra_set_capacity', 'extra_cancel_session', 'eq_create_order', 'eq_edit_order', 'eq_add_payment', 'eq_set_issued', 'eq_delete_order', 'eq_catalog_save', 'eq_set_order_status', 'eq_edit_line', 'eq_add_line', 'eq_delete_line', 'eq_set_order_date', 'equipment_requirement', 'payment_info_save', 'camp_register_guest', 'camp_update_guest',
        'camp_save', 'camp_tariff_save', 'camp_register', 'camp_update_participant', 'camp_pay', 'camp_cancel_payment', 'tl_add', 'tl_confirm',
        'tl_set_held', 'tl_replace_coach', 'tl_edit_session', 'lead_set_status', 'ind_roster_list', 'extra_roster_list',
        -- 0058: родителю долги и оплаты по всем видам
        'parent_dues',
        -- 0070: время дополнительной тренировки; функция администратора, внутри проверяется is_admin()
        'extra_set_time',
        -- 0040: старт подсчёта баллов
        'points_start', 'set_points_start',
        -- 0117: версии правил баллов; обе функции администратора проверяют is_admin() внутри
        'points_rules_list', 'points_rules_save',
        -- 0122: технический результат матча; админ или тренер, проверка внутри
        'set_match_technical',
        -- 0123: ручные баллы тренера; тренер игрока или администратор, проверка внутри
        'points_manual_status', 'points_manual_award', 'points_manual_cancel',
        -- 0124: состояние серии; доступ проверяется внутри (админ, тренер игрока, родитель, сам игрок)
        'points_series_info',
        -- 0126: анонимные ориентиры группы; доступ проверяется внутри
        'points_group_benchmark',
        -- 0127: сверка журнала баллов; только администратор, проверка внутри
        'points_consistency',
        -- 0120: занятие вне расписания (обычная и внеплановая); админ или тренер, проверка внутри
        'open_session_special',
        -- 0041: название и тип турнира (без взносов); вызывается из match_tournaments() с правами пользователя
        'tournament_label',
        -- 0042: тренеры видят все группы; журнал тренировок без часов
        'is_any_coach', 'trainer_attendance',
        -- 0043: штат матча и статистика тренеров (запись только админ, чтение админ и тренеры)
        'match_staff_set', 'match_staff_list', 'trainer_stats',
        -- 0044: заявка на пробную из приложения (лимит 3 в сутки, вызывает lead_submit)
        'lead_submit_app',
        -- 0045: запись родителей на индивидуальные, вратарские и дополнительные
        'booking_is_parent', 'booking_board', 'booking_signup', 'booking_cancel',
        'club_photo_set', 'club_photo_clear',
        -- 0051: события (чемпионат, фестиваль, кубок): тренеры и админ, без сумм
        'event_list', 'event_create', 'event_roster', 'event_roster_add', 'event_roster_remove', 'event_set_status', 'player_set_status', 'player_paused_month', 'event_add_game',
        -- 0053: взносы за события (только админ; проверка внутри)
        'event_set_fee', 'event_fees', 'event_payments', 'event_pay', 'event_discount', 'event_cancel_payment',
        -- 0054: взносы за матч (только админ; проверка внутри)
        'match_fees_list', 'match_payments_list', 'match_fee_add', 'match_set_fee', 'match_fee_remove', 'match_pay', 'match_discount', 'match_cancel_payment',
        -- 0063: турниры ребёнка для родителя, включая турниры без матчей
        'my_tournaments',
        -- 0078: кассовый отчёт по сотрудникам и способам (только админ; проверка внутри)
        'cash_report',
        -- 0085: локальный админ по локации (вызываются из политик RLS, данные — только по своему id)
        'is_location_admin', 'has_location_admin', 'group_location', 'player_location', 'camp_location', 'extra_place', 'my_locations',
        -- 0086: список оплат дня в кассе (область видимости как у отчёта)
        'cash_day_service',
        -- 0154: поиск игрока в кассе (админ — всех, локальный админ — только свои локации; проверка внутри)
        'cash_find_players',
        -- 0106: товарищеский матч команды без группы (только админ; проверка внутри)
        'save_match_team',
        -- 0109: причина и автор скидки на взносы (только админ; проверка внутри)
        'fee_discounts',
        -- 0111: статьи клуба (сохранение: админ и тренеры, автор и права проверяются внутри; is_any_guardian отличает родителя от гостя в RLS)
        'club_article_save', 'is_any_guardian',
        -- 0134: подтверждение участия в матчах (RSVP). Проверки доступа для политик RLS и операции тренера/родителя; доступ проверяется внутри каждой
        'is_coach_of_club', 'is_match_staff', 'rsvp_match_visible', 'rsvp_is_invited_guardian',
        'match_rsvp_create_draft', 'match_rsvp_update', 'match_rsvp_seed', 'match_rsvp_invite', 'match_rsvp_remove', 'match_rsvp_publish',
        'match_rsvp_delete_draft', 'match_rsvp_cancel', 'match_rsvp_reschedule', 'match_rsvp_coach_set', 'match_rsvp_remind_unanswered',
        'match_rsvp_summary', 'match_rsvp_roster', 'match_rsvp_answer', 'match_rsvp_answer_many', 'match_rsvp_my_matches',
        -- 0159 (#238): предикат обязательного согласия и текущая версия согласия; данных других людей не раскрывают
        'my_data_consent_ok', 'consent_current_version',
        -- 0162 (#238, PR 2a): принятие и отзыв согласий родителем; доступ проверяется внутри (только свои дети)
        'accept_consent', 'revoke_parent_consent',
        -- 0136: возврат отметок из снимка после переноса; доступ проверяется внутри
        'match_rsvp_restore_marks',
        -- 0160: самозапись на сборы. camp_parent_register: опекун ребёнка (проверка внутри); остальные: администратор или справочные данные
        'camp_set_public', 'camp_terms_save', 'camp_parent_register', 'camp_seats', 'camp_public', 'camp_visible_to_parent', 'camp_has_my_child',
        -- 0161: гостевые заявки (camp_apply: вошедший пользователь; camp_application_decide: администратор; camp_owns_participant: для политик RLS)
        'camp_apply', 'camp_application_decide', 'camp_owns_participant',
        -- 0166: правка и отмена своей записи (проверка внутри), возврат и замена (администратор, проверка внутри)
        'camp_parent_update', 'camp_parent_cancel', 'camp_refund', 'camp_replace_participant',
        -- 0168: длительность матча из настроек клуба; отдаёт один ключ и только клуба своего ребёнка
        'match_duration_minutes',
        -- 0169: документы сбора (права проверяет функция: админ, подтверждённый участник)
        'camp_documents_list', 'camp_document_admin_list', 'camp_document_begin', 'camp_document_path', 'camp_document_remove',
        -- 0170: рассылки по сбору (только администратор, проверка внутри)
        'camp_broadcast_preview', 'camp_broadcast_send', 'camp_broadcast_list', 'camp_broadcast_recipients')),
  '', 'список функций, доступных вошедшим пользователям, не расширился без решения');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f' and p.provolatile = 'v' and p.proname like 'is\_%'),
  0, 'проверочные функции is_* объявлены stable');

select * from finish();
rollback;
