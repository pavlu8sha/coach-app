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
      and p.proname not in ('group_rating', 'is_admin', 'is_coach_of_group', 'is_coach_of_player', 'is_coach_of_subscription', 'is_guardian_in_group', 'is_guardian_of')),
  '', 'гостю (anon) доступны только проверочные функции без данных');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('apply_match_points', 'claim_notifications', 'enqueue_notification', 'enqueue_to_admins', 'enqueue_to_guardians', 'notify_coach_group', 'notify_payment', 'notify_bonus', 'lead_submit', 'ind_book', 'ind_assert_admin', 'ind_price', 'ind_cap', 'eq_assert_admin', 'eq_number_taken', 'eq_price', 'camp_assert_admin', 'tl_assert_admin', 'finish_notification', 'notify_link_request', 'notify_data_request', 'rate_limit_hit', 'rule_for', 'tariff_for')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  '', 'служебные функции недоступны из приложения');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname not in (
        'award_bonus', 'can_see_team', 'cancel_link', 'child_linked', 'create_child_code', 'debtors', 'decide_link', 'delete_match',
        'erase_parent', 'export_my_data', 'group_parents', 'group_rating', 'is_admin', 'is_coach_of_group', 'is_coach_of_player',
        'is_coach_of_subscription', 'is_guardian_in_group', 'is_guardian_of', 'is_self_player', 'mark_attendance', 'open_session',
        'parent_calendar', 'parent_debts', 'recalc_match_points', 'redeem_child_code', 'reject_data_request', 'request_data_deletion', 'request_link',
        'retry_link', 'revoke_bonus', 'revoke_consent', 'save_match', 'search_players_for_link', 'set_my_role', 'set_notifications',
        'unlink_child',
        -- функции администратора из следующих миграций (0032–0039): внутри каждой проверяется is_admin()
        'create_subscription_month', 'ind_create_session', 'ind_add_player', 'ind_set_paid', 'ind_remove_player', 'ind_edit_session', 'ind_delete_session',
        'ind_set_regular', 'ind_set_attended', 'extra_create_session', 'extra_edit_session', 'extra_delete_session', 'extra_add_player', 'extra_remove_player',
        'extra_set_paid', 'extra_set_attended', 'eq_create_order', 'eq_edit_order', 'eq_add_payment', 'eq_set_issued', 'eq_delete_order', 'eq_catalog_save',
        'camp_save', 'camp_tariff_save', 'camp_register', 'camp_update_participant', 'camp_pay', 'camp_cancel_payment', 'tl_add', 'tl_confirm',
        'tl_set_held', 'tl_replace_coach', 'tl_edit_session', 'lead_set_status', 'ind_roster_list', 'extra_roster_list',
        -- 0058: родителю долги и оплаты по всем видам
        'parent_dues',
        -- 0040: старт подсчёта баллов
        'points_start', 'set_points_start',
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
        'event_list', 'event_create', 'event_roster', 'event_roster_add', 'event_roster_remove', 'event_add_game',
        -- 0053: взносы за события (только админ; проверка внутри)
        'event_set_fee', 'event_fees', 'event_payments', 'event_pay', 'event_discount', 'event_cancel_payment',
        -- 0054: взносы за матч (только админ; проверка внутри)
        'match_fees_list', 'match_payments_list', 'match_fee_add', 'match_set_fee', 'match_fee_remove', 'match_pay', 'match_discount', 'match_cancel_payment')),
  '', 'список функций, доступных вошедшим пользователям, не расширился без решения');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f' and p.provolatile = 'v' and p.proname like 'is\_%'),
  0, 'проверочные функции is_* объявлены stable');

select * from finish();
rollback;
