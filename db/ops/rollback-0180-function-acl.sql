-- Откат миграции 0180 (SEC-01). Запускать только по решению владельца, в SQL Editor целиком.
-- Возвращает EXECUTE ролям anon и authenticated на функции, с которых 0180 их снял (как по умолчанию в Supabase).
-- Не меняет тела функций и не трогает данные. Сам откат снова открывает риск SEC-01; после него нужно решение по ACL.
grant execute on function
  apply_match_points(uuid), award_bonus(uuid,integer,text), cancel_link(uuid), debt_start(), debtors(date),
  decide_link(uuid,boolean), delete_match(uuid), erase_parent(uuid), export_my_data(), group_parents(uuid),
  mark_attendance(uuid,jsonb), open_session(uuid,date), parent_debts(), recalc_match_points(uuid),
  reject_data_request(uuid,text), request_data_deletion(), request_link(uuid,text), retry_link(uuid),
  revoke_bonus(uuid), revoke_consent(uuid), rule_for(uuid,text,date),
  save_match(uuid,uuid,date,text,integer,integer,jsonb), search_players_for_link(text),
  tariff_for(uuid,uuid,date), tbilisi_day(timestamptz)
to anon;

grant execute on function
  apply_match_points(uuid), debt_start(), points_rules_for(uuid,date), rule_for(uuid,text,date), tariff_for(uuid,uuid,date)
to authenticated;

-- Проверка после отката (ожидаемо: строки с true):
select 'anon' as role, has_function_privilege('anon', 'apply_match_points(uuid)', 'execute') as can_execute
union all select 'authenticated', has_function_privilege('authenticated', 'apply_match_points(uuid)', 'execute');
