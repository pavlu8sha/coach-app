# SEC-01: закрыть лишние права anon и authenticated на функции (условия приёмки)

Источник: общий аудит 2026-11-11, `audit-general/audit-2026-11-11.md`, раздел SEC-01.
Миграция: `db/migrations/0180_function_acl.sql`. Откат: `db/ops/rollback-0180-function-acl.sql`.

## Проблема

В боевой базе Supabase по умолчанию выдаёт EXECUTE ролям `anon` и `authenticated` на все функции `public`.
`revoke execute ... from public` (как в 0027) эти прямые гранты не снимает. Тестовая база (`setup_local.sql`)
таких умолчаний не имеет, поэтому тесты этого не видят.

## Проверка боевой базы 12.11.2026

Павел выполнил `readonly-acl-check.sql`, запрос 2 (функции с EXECUTE у anon). Результат: `camp_public`, `current_user_id`,
`group_rating`, `ind_ext_id`, `is_admin`, `is_coach_of_group`, `is_coach_of_player`, `is_coach_of_subscription`,
`is_guardian_in_group`, `is_guardian_of`, `rls_auto_enable`. Ни одной функции из списка 0180 у гостя в проде нет:
умолчания Supabase на гостя там не действуют, тестовая база в этой части совпадает с боевой. Для гостя 0180 в проде
ничего не меняет и закрепляет состояние (страж от будущих грантов). Результат запроса 3 (права authenticated) не получен.

`rls_auto_enable` в репозитории нет. По названию это функция Supabase для автоматического включения RLS на новых
таблицах (событийный триггер); её тип и тело я не сверял. 0180 её не трогает, отдельная проверка за Павлом:
`select prorettype::regtype, prosecdef from pg_proc where proname = 'rls_auto_enable';`
(если тип `event_trigger`, напрямую её вызвать нельзя).

Следствие для preflight: если в проде у authenticated этих пяти функций тоже нет, строка 0180 покажет `applied = true`
ещё до применения. Это верно по смыслу: целевое состояние прав уже есть, применять миграцию не обязательно, повторный запуск безопасен.

## Условия приёмки

1. **Гость (anon) не может выполнять служебные функции.** Для 25 функций из списка миграции `has_function_privilege('anon', ...)` = false.
   Список: `apply_match_points, award_bonus, cancel_link, debt_start, debtors, decide_link, delete_match, erase_parent,
   export_my_data, group_parents, mark_attendance, open_session, parent_debts, recalc_match_points, reject_data_request,
   request_data_deletion, request_link, retry_link, revoke_bonus, revoke_consent, rule_for, save_match,
   search_players_for_link, tariff_for, tbilisi_day`.
2. **Вошедший пользователь не может выполнять функции, которые приложение не вызывает.** Для `apply_match_points`,
   `debt_start`, `points_rules_for`, `rule_for`, `tariff_for`: `has_function_privilege('authenticated', ...)` = false.
   Приложение (`web/src`, `supabase/`) этих функций не вызывает через `.rpc`. Вызовы из других функций идут с правами владельца (security definer).
3. **Функции, которые нужны приложению, не сломаны.** `authenticated` сохраняет EXECUTE у `save_match`, `delete_match`,
   `mark_attendance`, `open_session` и остальных, которые вызывает приложение (проверяет тест).
   `anon` сохраняет EXECUTE у `camp_public`, `group_rating`, `is_admin`, `is_coach_of_*`, `is_guardian_*` (список из
   `rls_definer_hardening_test.sql`). Тестовая база без умолчаний этого не показывает; проверяет `readonly-acl-check.sql` на проде.
4. **Функции, на которые ссылаются политики RLS, не трогаются для anon.** `can_see_team` используется в политике; если снять у anon
   EXECUTE, запрос гостя к таблице упадёт с ошибкой вместо пустого результата. Поэтому у `anon` `can_see_team` остаётся (отмечено как риск, см. отчёт).
   `current_user_id`, `ind_ext_id` тоже не трогаются: они используются во всех политиках и возвращают null для гостя.
5. **Прямой вызов из роли гостя возвращает отказ прав**, а не данные: `set role anon; select apply_match_points(...)` → `42501 permission denied`.
6. **Права service_role не меняются** (бот и Edge Functions работают через неё).
7. **Миграция меняет только права.** Данные, тела функций и политики не меняются.
8. **Строка в `db/ops/preflight.sql`** показывает `applied = true` после применения и `false` до него.
9. **Тесты ловят регресс:** `db/tests/rls_function_acl_test.sql` падает на базе с умолчаниями Supabase до миграции 0180 и проходит после неё.
10. **Откат** возвращает `anon` и `authenticated` EXECUTE ровно на тех функциях, на которых миграция их сняла.

## Вне этой задачи (отдельные решения)

- Добавление умолчаний Supabase в `setup_local.sql` сделало бы тест доступа authenticated (`rls_definer_hardening_test.sql`, п. 4)
  красным на нескольких сотнях функций. Это отдельная работа над тестами, не часть SEC-01.
- `alter default privileges` для будущих функций: меняет правила для всех новых миграций, решение владельца.
- Проверка боевых ACL (`audit-general/readonly-acl-check.sql`) выполняется Павлом в SQL Editor до применения миграции.
