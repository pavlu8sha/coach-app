-- 0180 (SEC-01, аудит 2026-11-11): снять лишние прямые права гостя (anon) и вошедшего (authenticated) на функции public.
-- На базе с умолчаниями Supabase EXECUTE выдаётся ролям anon и authenticated на все функции; revoke ... from public
-- (как в 0027) эти гранты не снимает. Проверка боевой базы 12.11 (readonly-acl-check.sql, п. 2): у anon этих функций
-- нет, поэтому для гостя миграция там ничего не меняет и работает как страж. Права authenticated (п. 3) не сверены. Условия приёмки: docs/SEC_01_FUNCTION_ACL_ACCEPTANCE.md. Откат: db/ops/rollback-0180-function-acl.sql.
-- Меняются только права. Тела функций, политики и права service_role не трогаются.

-- Гость: служебные функции, которые приложение не вызывает гостем (вызовы из других функций идут с правами владельца).
-- can_see_team, current_user_id, ind_ext_id здесь не снимаются: политики RLS вычисляют их и для гостя.
revoke execute on function
  apply_match_points(uuid), award_bonus(uuid,integer,text), cancel_link(uuid), debt_start(), debtors(date),
  decide_link(uuid,boolean), delete_match(uuid), erase_parent(uuid), export_my_data(), group_parents(uuid),
  mark_attendance(uuid,jsonb), open_session(uuid,date), parent_debts(), recalc_match_points(uuid),
  reject_data_request(uuid,text), request_data_deletion(), request_link(uuid,text), retry_link(uuid),
  revoke_bonus(uuid), revoke_consent(uuid), rule_for(uuid,text,date),
  save_match(uuid,uuid,date,text,integer,integer,jsonb), search_players_for_link(text),
  tariff_for(uuid,uuid,date), tbilisi_day(timestamptz)
from anon;

-- Вошедший: функции, которые приложение не вызывает через .rpc (проверено по web/src и supabase/).
-- Вызовы из definer-функций идут с правами владельца; tbilisi_day оставлен вошедшему, его вызывает attendance_stats (security invoker).
revoke execute on function
  apply_match_points(uuid), debt_start(), points_rules_for(uuid,date), rule_for(uuid,text,date), tariff_for(uuid,uuid,date)
from authenticated;
