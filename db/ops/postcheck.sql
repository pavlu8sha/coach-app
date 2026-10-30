-- Проверка ключевых функций и прав доступа после применения миграций. Только чтение. Каждая строка должна быть ok = true.
with expected(fn, for_app) as (values
  ('create_child_code(uuid)', true), ('redeem_child_code(text)', true),
  ('enqueue_to_guardians(uuid,text,text)', false), ('notify_payment()', false), ('notify_bonus()', false), ('notify_coach_group()', false),
  ('create_subscription_month(date)', true), ('debtors(date)', true), ('parent_debts()', true),
  ('attendance_stats(date,date)', true), ('match_stats(date,date,text)', true),
  ('ind_create_session(date,time,boolean,text)', true), ('ind_set_paid(uuid,uuid,boolean)', true), ('ind_set_attended(uuid,uuid,boolean)', true), ('ind_book(uuid,uuid)', false),
  ('extra_create_session(date,numeric,text)', true), ('extra_set_paid(uuid,uuid,boolean,text,numeric)', true), ('extra_set_attended(uuid,uuid,boolean)', true),
  ('eq_create_order(uuid,jsonb,text,text,boolean,text,numeric)', true), ('eq_add_payment(uuid,numeric)', true), ('eq_set_issued(uuid,text,boolean,text,date)', true), ('eq_catalog_save(text,numeric,date)', true),
  ('camp_save(uuid,text,text,date,date,numeric,date,date,boolean)', true), ('camp_pay(uuid,numeric,text,date,text,text)', true), ('camp_cancel_payment(uuid)', true),
  ('tl_add(date,text,text,text,time,time,text,boolean)', true), ('tl_confirm(date,text,text,time,time,text,text[])', true),
  ('parent_calendar(uuid,date,date)', true),
  ('lead_set_status(uuid,text,text)', true), ('points_start()', true), ('set_points_start(date)', true)
)
select fn,
       to_regprocedure(fn) is not null as exists_,
       coalesce(has_function_privilege('authenticated', to_regprocedure(fn), 'execute'), false) as app_can_call,
       for_app as app_should_call,
       to_regprocedure(fn) is not null and coalesce(has_function_privilege('authenticated', to_regprocedure(fn), 'execute'), false) = for_app as ok
from expected
union all
select 'таблица ' || t, to_regclass(t) is not null, null, null, to_regclass(t) is not null
from unnest(array['child_codes', 'child_links', 'extra_sessions', 'extra_bookings', 'equipment_issues', 'individual_regulars', 'lead_drafts', 'notifications']) t
union all
select 'RLS включён: ' || t, true, null, null, coalesce((select relrowsecurity from pg_class where oid = to_regclass(t)), false)
from unnest(array['child_codes', 'extra_sessions', 'extra_bookings', 'equipment_issues', 'individual_regulars', 'lead_drafts', 'notifications']) t
order by ok, 1;
