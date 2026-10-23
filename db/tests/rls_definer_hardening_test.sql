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
    where n.nspname = 'public' and p.proname in ('apply_match_points', 'claim_notifications', 'enqueue_notification', 'enqueue_to_admins', 'finish_notification', 'notify_link_request', 'notify_data_request', 'rate_limit_hit', 'rule_for', 'tariff_for')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  '', 'служебные функции недоступны из приложения');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname not in (
        'award_bonus', 'can_see_team', 'cancel_link', 'child_linked', 'create_child_code', 'debtors', 'decide_link', 'delete_match',
        'erase_parent', 'export_my_data', 'group_parents', 'group_rating', 'is_admin', 'is_coach_of_group', 'is_coach_of_player',
        'is_coach_of_subscription', 'is_guardian_in_group', 'is_guardian_of', 'is_self_player', 'mark_attendance', 'open_session',
        'parent_debts', 'recalc_match_points', 'redeem_child_code', 'reject_data_request', 'request_data_deletion', 'request_link',
        'retry_link', 'revoke_bonus', 'revoke_consent', 'save_match', 'search_players_for_link', 'set_my_role', 'set_notifications',
        'unlink_child')),
  '', 'список функций, доступных вошедшим пользователям, не расширился без решения');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f' and p.provolatile = 'v' and p.proname like 'is\_%'),
  0, 'проверочные функции is_* объявлены stable');

select * from finish();
rollback;
