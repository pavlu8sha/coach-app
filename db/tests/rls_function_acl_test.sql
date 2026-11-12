-- pgTAP: SEC-01 (аудит 2026-11-11). Гость (anon) и вошедший (authenticated) не выполняют служебные функции;
-- функции, которые нужны приложению, остаются доступны. Условия: docs/SEC_01_FUNCTION_ACL_ACCEPTANCE.md.
-- Красная проверка: на базе с умолчаниями Supabase (EXECUTE для anon/authenticated на все функции public) до миграции 0180.
begin;
create extension if not exists pgtap;
select plan(7);

-- 1. гость не выполняет служебные функции (условие 1)
select is(
  (select coalesce(string_agg(s, ', ' order by s), '') from unnest(array[
    'apply_match_points(uuid)', 'award_bonus(uuid,integer,text)', 'cancel_link(uuid)', 'debt_start()', 'debtors(date)',
    'decide_link(uuid,boolean)', 'delete_match(uuid)', 'erase_parent(uuid)', 'export_my_data()', 'group_parents(uuid)',
    'mark_attendance(uuid,jsonb)', 'open_session(uuid,date)', 'parent_debts()', 'recalc_match_points(uuid)',
    'reject_data_request(uuid,text)', 'request_data_deletion()', 'request_link(uuid,text)', 'retry_link(uuid)',
    'revoke_bonus(uuid)', 'revoke_consent(uuid)', 'rule_for(uuid,text,date)', 'save_match(uuid,uuid,date,text,integer,integer,jsonb)',
    'search_players_for_link(text)', 'tariff_for(uuid,uuid,date)', 'tbilisi_day(timestamptz)'
  ]) s where has_function_privilege('anon', s, 'execute')),
  '', 'гостю (anon) не выполняются служебные функции из списка 0180');

-- 2. вошедший не выполняет функции, которые приложение не вызывает (условие 2)
select is(
  (select coalesce(string_agg(s, ', ' order by s), '') from unnest(array[
    'apply_match_points(uuid)', 'debt_start()', 'points_rules_for(uuid,date)', 'rule_for(uuid,text,date)', 'tariff_for(uuid,uuid,date)'
  ]) s where has_function_privilege('authenticated', s, 'execute')),
  '', 'вошедшему не выполняются функции, которые приложение не вызывает');

-- 3. функции, на которые ссылаются политики RLS, не удалены (условие 4). Права гостя на них проверяет
-- readonly-проверка на боевой базе (audit-general/readonly-acl-check.sql): тестовая база без умолчаний Supabase
-- гостю их не выдаёт, поэтому здесь проверяется только наличие.
select is(
  (select coalesce(string_agg(s, ', ' order by s), '') from unnest(array[
    'is_admin()', 'current_user_id()', 'can_see_team(uuid,text)'
  ]) s where to_regprocedure(s) is null),
  '', 'функции политик RLS (is_admin, current_user_id, can_see_team) существуют');

-- 4. вошедшему остаются функции, которые вызывает приложение (условие 3). recalc_match_points здесь нет:
-- #625 (0186) снимает его у вошедшего вместе со старой системой баллов.
select is(
  (select coalesce(string_agg(s, ', ' order by s), '') from unnest(array[
    'save_match(uuid,uuid,date,text,integer,integer,jsonb)', 'delete_match(uuid)',
    'mark_attendance(uuid,jsonb)', 'open_session(uuid,date)', 'request_link(uuid,text)', 'export_my_data()'
  ]) s where not has_function_privilege('authenticated', s, 'execute')),
  '', 'вошедшему остаются функции, которые вызывает приложение');

-- 5. прямой вызов служебной функции гостем отказывается по правам (условие 5)
set local role anon;
select throws_ok(
  $$select apply_match_points(gen_random_uuid())$$, '42501', null,
  'гость получает отказ прав при вызове apply_match_points');
reset role;

-- 6. то же для вошедшего (условие 2)
set local role authenticated;
select throws_ok(
  $$select apply_match_points(gen_random_uuid())$$, '42501', null,
  'вошедший получает отказ прав при вызове apply_match_points');
reset role;

-- 7. вызов из функции с правами владельца работает: save_match доступна вошедшему (условие 3, проверка без ошибки прав)
select ok(has_function_privilege('authenticated', 'save_match(uuid,uuid,date,text,integer,integer,jsonb)', 'execute'),
  'save_match остаётся доступна вошедшему после миграции');

select * from finish();
rollback;
