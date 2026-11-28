#!/usr/bin/env bash
# Прогон миграций и pgTAP-тестов доступа на чистой локальной БД PostgreSQL (без Supabase).
# Нужны: PostgreSQL 16 с расширением pgTAP. Запуск: PGUSER=postgres scripts/run-db-tests.sh
# Переменные: DB_NAME (по умолчанию kickstart_test), PSQL (по умолчанию "psql").
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
# shellcheck source=lib/local-db-guard.sh
. scripts/lib/local-db-guard.sh
local_db_guard "$PSQL" || exit 2

$PSQL -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }

run db/tests/setup_local.sql
for f in db/migrations/*.sql; do
  echo "== $f"; run "$f"
done

fail=0
# preflight.sql должен выполняться, не падать на отсутствующих объектах и на полной базе
# показывать только APPLIED или SUPERSEDED. NOT_APPLIED/UNKNOWN — красный тест.
echo "== db/ops/preflight.sql"
if ! pf=$($PSQL -q -At -v ON_ERROR_STOP=1 -d "$DB" -f db/ops/preflight.sql 2>&1); then
  echo "$pf"; echo "not ok - preflight.sql не выполняется"; fail=1
else
  bad=$(printf '%s\n' "$pf" | awk -F'|' '$1 ~ /^[0-9]{4}_/ && $3 != "APPLIED" && $3 != "SUPERSEDED" && $1 != "0224_points_rules_match_rating" {print}')
  if [ -n "$bad" ]; then echo "$bad"; echo "not ok - preflight.sql: NOT_APPLIED/UNKNOWN на полной базе"; fail=1; fi
  for m in 0047_ind_no_autobook 0052_ind_change_type 0081_match_stats_drop_old_overload 0091_event_list_players_count; do
    st=$(printf '%s\n' "$pf" | awk -F'|' -v m="$m" '$1 == m {print $3}')
    [ "$st" = "SUPERSEDED" ] || { echo "$pf" | grep "^$m|"; echo "not ok - $m: ожидался SUPERSEDED, получено '$st'"; fail=1; }
  done
  # Четвёртая колонка (note) у 0176: на полной базе должно быть ровно «applied» (0173 и 0175 учтены).
  echo "$pf" | grep -qxF '0176_consent_claim_check|t|APPLIED|applied' || { echo "$pf" | grep '^0176'; echo "not ok - preflight.sql: 0176 не в состоянии APPLIED/applied"; fail=1; }
fi
[ "$fail" = 0 ] && echo "ok - preflight.sql выполняется, статусы APPLIED/SUPERSEDED ($(printf '%s\n' "$pf" | grep -cE '\|APPLIED\|'))"
# preflight.sql на базе БЕЗ новых миграций не должен падать: строка неприменённой миграции даёт NOT_APPLIED (урок 2026-11-16: ::regclass падал на отсутствующей таблице).
# Случай 1: нет миграций мероприятий (0202, 0204); случай 2: нет только 0204 (0202 применена).
preflight_partial() {  # $1 метка, $2 шаблон пропускаемых файлов (egrep), остальные аргументы: ожидаемые NOT_APPLIED строки
  local label=$1 skip=$2; shift 2
  local pdb="${DB}_pre"
  $PSQL -q -d postgres -c "drop database if exists $pdb" -c "create database $pdb"
  $PSQL -q -v ON_ERROR_STOP=1 -d "$pdb" -f db/tests/setup_local.sql
  for f in db/migrations/*.sql; do
    if echo "$f" | grep -Eq "$skip"; then continue; fi
    $PSQL -q -v ON_ERROR_STOP=1 -d "$pdb" -f "$f" >/dev/null 2>&1 || { echo "not ok - preflight ($label): миграция $f не применилась"; fail=1; }
  done
  local out
  if ! out=$($PSQL -q -At -v ON_ERROR_STOP=1 -d "$pdb" -f db/ops/preflight.sql 2>&1); then
    echo "$out"; echo "not ok - preflight.sql падает на базе без новых миграций ($label)"; fail=1
  else
    local m st bad=0
    for m in "$@"; do
      st=$(printf '%s\n' "$out" | awk -F'|' -v m="$m" '$1 == m {print $3}')
      [ "$st" = "NOT_APPLIED" ] || { echo "not ok - preflight ($label): $m ожидался NOT_APPLIED, получено '$st'"; bad=1; fail=1; }
    done
    [ "$bad" = 0 ] && echo "ok - preflight.sql на базе без новых миграций ($label) выполняется, неприменённые строки NOT_APPLIED"
  fi
  $PSQL -q -d postgres -c "drop database if exists $pdb"
}
# 0210 (платежи мероприятий) зависит от 0204 и 0202, 0211 (скрытие черновика) от 0210: при пропуске зависимости пропускается и зависимая миграция.
preflight_partial "без 0202, 0204, 0210 и 0211" '0202_club_events|0204_club_event_participants|0210_club_event_payments|0211_club_event_delete_draft' 0202_club_events 0204_club_event_participants 0210_club_event_payments 0211_club_event_delete_draft
preflight_partial "без 0204, 0210 и 0211" '0204_club_event_participants|0210_club_event_payments|0211_club_event_delete_draft' 0204_club_event_participants 0210_club_event_payments 0211_club_event_delete_draft
preflight_partial "без 0210 и 0211" '0210_club_event_payments|0211_club_event_delete_draft' 0210_club_event_payments 0211_club_event_delete_draft
preflight_partial "без 0211" '0211_club_event_delete_draft' 0211_club_event_delete_draft
# 0212 (set_my_role подтверждает сохранение) заменяет функцию из 0022: на базе без неё preflight не падает, строка NOT_APPLIED.
preflight_partial "без 0212" '0212_set_my_role_confirm' 0212_set_my_role_confirm
# 0207 (шаг 2c) проверяет отметку freeze_2c в таблице equipment_bundle_steps: на базе без 0205 таблицы нет, preflight не должен падать.
# 0208 требует 0205 и 0207 (отметка freeze_2c), поэтому в «без 0207» и «без 0205 и 0207» её тоже пропускаем.
preflight_partial "без 0207 и 0208" '0207_eq_freeze_2c|0208_eq_auto_recalc' 0207_eq_freeze_2c 0208_eq_auto_recalc
preflight_partial "без 0205, 0207 и 0208" '0205_eq_bundle_model|0207_eq_freeze_2c|0208_eq_auto_recalc' 0205_eq_bundle_model 0207_eq_freeze_2c 0208_eq_auto_recalc
preflight_partial "без 0208" '0208_eq_auto_recalc' 0208_eq_auto_recalc
# 0209 (профиль игрока, #654) самостоятельна: на базе без неё preflight не должен падать (to_regclass), строка 0209 даёт NOT_APPLIED.
preflight_partial "без 0209" '0209_player_profile_attributes' 0209_player_profile_attributes
# 0214 (идемпотентность платежей, #724) самостоятельна: на базе без неё preflight не должен падать, строка 0214 даёт NOT_APPLIED.
preflight_partial "без 0214" '0214_payment_idempotency' 0214_payment_idempotency
# 0215 (my_children, серверный список детей) самостоятельна: на базе без неё preflight не падает (to_regprocedure), строка 0215 даёт NOT_APPLIED.
preflight_partial "без 0215" '0215_my_children' 0215_my_children
# 0231 (идемпотентность возврата за сбор, #721) самостоятельна: на базе без неё preflight не падает, строка 0231 даёт NOT_APPLIED.
preflight_partial "без 0231" '0231_camp_refund_idempotency' 0231_camp_refund_idempotency
# 0216 (payment_set_method) самостоятельна: на базе без неё preflight не падает, строка 0216 даёт NOT_APPLIED.
preflight_partial "без 0216" '0216_payment_set_method' 0216_payment_set_method
# 0217 (my_link_requests, my_pending_consents) самостоятельна: на базе без неё preflight не падает, строка 0217 даёт NOT_APPLIED.
preflight_partial "без 0217" '0217_link_screens' 0217_link_screens
# 0218 (ник родителя: колонка и group_parent_usernames) самостоятельна: на базе без неё preflight не падает, строка 0218 даёт NOT_APPLIED.
preflight_partial "без 0218" '0218_parent_tg_username' 0218_parent_tg_username
# 0219 (player_group_since) самостоятельна: на базе без неё preflight не падает (to_regprocedure), строка 0219 даёт NOT_APPLIED.
preflight_partial "без 0219" '0219_player_group_since' 0219_player_group_since
# 0220 (finish/renew lease) проверяет отсутствие старой сигнатуры finish_notification: на базе без неё строка NOT_APPLIED, preflight не падает.
preflight_partial "без 0220" '0220_notifications_finish_lease' 0220_notifications_finish_lease
# 0221 (session_guest_discount, расширение fee_discount_log) самостоятельна: на базе без неё preflight не падает (to_regprocedure, to_regclass), строка 0221 даёт NOT_APPLIED.
preflight_partial "без 0221" '0221_visit_discount' 0221_visit_discount
# 0222 (is_admin против pg_temp) пересоздаёт функцию, существующую с 0002: на базе без 0222 функция есть со старым телом (search_path=public), строка 0222 даёт NOT_APPLIED, preflight не падает.
preflight_partial "без 0222" '0222_is_admin_pg_temp_hardening' 0222_is_admin_pg_temp_hardening
# 0223 (оценка тренера за матч) самостоятельна: на базе без неё preflight не падает (information_schema, to_regprocedure), строка 0223 даёт NOT_APPLIED.
# Строка 0224 (версия правил от 2026-12-01): на пустой базе без клуба версии нет, статус NOT_APPLIED; её проверяет db/tests/migration_match_rating.sh (нет версии, старая, новая).
preflight_partial "без 0223" '0223_match_rating_points' 0223_match_rating_points
# 0225 (remove_match_player с проверкой клуба) пересоздаёт функцию 0192/0223: на базе без 0225 функция есть со старым телом, строка 0225 даёт NOT_APPLIED, preflight не падает.
preflight_partial "без 0225" '0225_remove_match_player_club' 0225_remove_match_player_club
# 0225 меняет семь функций (четыре RPC, save_match_team и два helper-а): частичные состояния (ревью #830, P2) не должны показываться как APPLIED.
preflight_0225_state() {  # $1 метка, $2 sql, который портит состояние после полной миграции
  local label=$1 sql=$2 pdb="${DB}_pre" out st
  $PSQL -q -d postgres -c "drop database if exists $pdb" -c "create database $pdb"
  $PSQL -q -v ON_ERROR_STOP=1 -d "$pdb" -f db/tests/setup_local.sql
  for f in db/migrations/*.sql; do $PSQL -q -v ON_ERROR_STOP=1 -d "$pdb" -f "$f" >/dev/null 2>&1 || { echo "not ok - preflight 0225 ($label): миграция $f не применилась"; fail=1; }; done
  $PSQL -q -v ON_ERROR_STOP=1 -d "$pdb" -c "$sql" >/dev/null
  out=$($PSQL -q -At -v ON_ERROR_STOP=1 -d "$pdb" -f db/ops/preflight.sql 2>&1) || { echo "$out"; echo "not ok - preflight 0225 ($label): preflight падает"; fail=1; }
  st=$(printf '%s\n' "$out" | awk -F'|' '$1 == "0225_remove_match_player_club" {print $3}')
  if [ "$st" = "NOT_APPLIED" ]; then echo "ok - preflight 0225 ($label): частичное состояние даёт NOT_APPLIED"; else echo "not ok - preflight 0225 ($label): ожидался NOT_APPLIED, получено '$st'"; fail=1; fi
  $PSQL -q -d postgres -c "drop database if exists $pdb"
}
preflight_0225_state "save_match без pg_temp в search_path" "alter function public.save_match(uuid,uuid,date,text,int,int,jsonb) set search_path = public"
preflight_0225_state "remove_match_player без pg_temp в search_path" "alter function public.remove_match_player(uuid,uuid) set search_path = public"
preflight_0225_state "save_match доступна anon" "grant execute on function public.save_match(uuid,uuid,date,text,int,int,jsonb) to anon"
preflight_0225_state "save_match недоступна authenticated" "revoke execute on function public.save_match(uuid,uuid,date,text,int,int,jsonb) from authenticated"
preflight_0225_state "remove_match_player со старым телом (без проверки клуба)" "do \$f\$ begin execute replace(pg_get_functiondef('public.remove_match_player(uuid,uuid)'::regprocedure), 'club_event_current_club', 'current_user_id'); end \$f\$"
preflight_0225_state "save_match со старым телом (без проверки клуба)" "do \$f\$ begin execute replace(pg_get_functiondef('public.save_match(uuid,uuid,date,text,integer,integer,jsonb)'::regprocedure), 'club_event_current_club', 'current_user_id'); end \$f\$"
preflight_0225_state "set_match_technical со старым телом (без проверки клуба)" "do \$f\$ begin execute replace(pg_get_functiondef('public.set_match_technical(uuid,boolean)'::regprocedure), 'club_event_current_club', 'current_user_id'); end \$f\$"
preflight_0225_state "delete_match со старым телом (без проверки клуба)" "do \$f\$ begin execute replace(pg_get_functiondef('public.delete_match(uuid)'::regprocedure), 'club_event_current_club', 'current_user_id'); end \$f\$"
preflight_0225_state "set_match_technical без pg_temp в search_path" "alter function public.set_match_technical(uuid,boolean) set search_path = public"
preflight_0225_state "delete_match без pg_temp в search_path" "alter function public.delete_match(uuid) set search_path = public"
preflight_0225_state "delete_match доступна anon" "grant execute on function public.delete_match(uuid) to anon"
preflight_0225_state "remove_match_player не SECURITY DEFINER" "alter function public.remove_match_player(uuid,uuid) security invoker"
preflight_0225_state "save_match не SECURITY DEFINER" "alter function public.save_match(uuid,uuid,date,text,integer,integer,jsonb) security invoker"
preflight_0225_state "set_match_technical не SECURITY DEFINER" "alter function public.set_match_technical(uuid,boolean) security invoker"
preflight_0225_state "delete_match не SECURITY DEFINER" "alter function public.delete_match(uuid) security invoker"
preflight_0225_state "set_match_technical недоступна authenticated" "revoke execute on function public.set_match_technical(uuid,boolean) from authenticated"
preflight_0225_state "подстрока club_event_current_club только в комментарии" "do \$f\$ begin execute replace(pg_get_functiondef('public.delete_match(uuid)'::regprocedure), 'uclub := club_event_current_club()', 'uclub := current_user_id(); -- club_event_current_club()'); end \$f\$"
preflight_0225_state "is_any_coach без pg_temp в search_path" "alter function public.is_any_coach() set search_path = public"
preflight_0225_state "club_event_current_club без pg_temp в search_path" "alter function public.club_event_current_club() set search_path = public"
preflight_0225_state "is_any_coach доступна anon" "grant execute on function public.is_any_coach() to anon"
preflight_0225_state "club_event_current_club недоступна authenticated" "revoke execute on function public.club_event_current_club() from authenticated"
preflight_0225_state "is_any_coach со старым телом (таблица без public.)" "do \$f\$ begin execute replace(pg_get_functiondef('public.is_any_coach()'::regprocedure), 'public.coach_groups', 'coach_groups'); end \$f\$"
preflight_0225_state "is_any_coach без public.current_user_id()" "do \$f\$ begin execute replace(pg_get_functiondef('public.is_any_coach()'::regprocedure), 'public.current_user_id()', 'current_user_id()'); end \$f\$"
preflight_0225_state "is_any_coach не SECURITY DEFINER" "alter function public.is_any_coach() security invoker"
preflight_0225_state "club_event_current_club теряет public.users" "do \$f\$ begin execute replace(pg_get_functiondef('public.club_event_current_club()'::regprocedure), 'public.users', 'users'); end \$f\$"
preflight_0225_state "club_event_current_club теряет public.clubs" "do \$f\$ begin execute replace(pg_get_functiondef('public.club_event_current_club()'::regprocedure), 'public.clubs', 'clubs'); end \$f\$"
preflight_0225_state "club_event_current_club теряет public.current_user_id()" "do \$f\$ begin execute replace(pg_get_functiondef('public.club_event_current_club()'::regprocedure), 'public.current_user_id()', 'current_user_id()'); end \$f\$"
preflight_0225_state "club_event_current_club не SECURITY DEFINER" "alter function public.club_event_current_club() security invoker"
preflight_0225_state "save_match_team со старым телом (первый клуб по id)" "do \$f\$ begin execute replace(pg_get_functiondef('public.save_match_team(text,date,text,integer,integer,jsonb)'::regprocedure), 'club := club_event_current_club();', 'select c.id into club from clubs c order by c.id limit 1;'); end \$f\$"
preflight_0225_state "save_match_team без pg_temp в search_path" "alter function public.save_match_team(text,date,text,integer,integer,jsonb) set search_path = public"
preflight_0225_state "save_match_team доступна anon" "grant execute on function public.save_match_team(text,date,text,integer,integer,jsonb) to anon"
# 0226 (взнос за матч с подтверждением) пересоздаёт функции матчей с подтверждением: на базе без неё колонки matches.fee нет, preflight не падает (information_schema, to_regprocedure), строка 0226 даёт NOT_APPLIED.
preflight_partial "без 0226" '0226_match_rsvp_fee' 0226_match_rsvp_fee
# 0227 (единый экран матча, PR 2) пересоздаёт match_rsvp_cancel/reschedule/update и save_match: на базе без неё функции есть со старыми телами, строка 0227 даёт NOT_APPLIED.
preflight_partial "без 0227" '0227_match_unified_pr2' 0227_match_unified_pr2
# 0232 (сериализация оплат event_pay / match_pay, #722): на базе без неё функции есть со старым телом без блокировки.
preflight_partial "без 0232" '0232_fee_pay_serialization' 0232_fee_pay_serialization
for t in db/tests/*_test.sql; do
  echo "== $t"
  out=$($PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t" 2>&1) || { echo "$out"; fail=1; continue; }
  echo "$out" | grep -E '^ *(ok|not ok) ' || true
  if echo "$out" | grep -qE 'not ok|Looks like you (failed|planned)'; then echo "$out"; fail=1; fi
done
echo "== db/tests/concurrency_match_rsvp.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_match_rsvp.sh || fail=1
echo "== db/tests/concurrency_match_unified_pr2.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_match_unified_pr2.sh || fail=1
echo "== db/tests/concurrency_booking.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_booking.sh || fail=1
echo "== db/tests/concurrency_consent_versions.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_consent_versions.sh || fail=1
echo "== db/tests/concurrency_camp_seats.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_camp_seats.sh || fail=1
echo "== db/tests/concurrency_camp_applications.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_camp_applications.sh || fail=1
echo "== db/tests/concurrency_own_visit_backfill.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_own_visit_backfill.sh || fail=1
echo "== db/tests/concurrency_camp_refund.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_camp_refund.sh || fail=1
echo "== db/tests/concurrency_camp_refund_idem.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_camp_refund_idem.sh || fail=1
echo "== db/tests/concurrency_consent_record.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_consent_record.sh || fail=1
echo "== db/tests/concurrency_consent_claim.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_consent_claim.sh || fail=1
# Цикл 2c проверяет откат 0207 «до пересчётов»: идёт до скриптов, создающих заказы (с 0208 их создание оставляет запуски расчёта).
echo "== db/tests/eq_freeze_2c_cycle.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/eq_freeze_2c_cycle.sh || fail=1
echo "== db/tests/concurrency_eq_freeze_late.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_eq_freeze_late.sh || fail=1
echo "== db/tests/concurrency_eq_payments.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_eq_payments.sh || fail=1
echo "== db/tests/concurrency_eq_create_order.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_eq_create_order.sh || fail=1
echo "== db/tests/concurrency_eq_bundle_recalc.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_eq_bundle_recalc.sh || fail=1
echo "== db/tests/concurrency_eq_auto_recalc.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_eq_auto_recalc.sh || fail=1
echo "== db/tests/atomic_0188.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/atomic_0188.sh || fail=1
echo "== db/tests/concurrency_club_event_seats.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_club_event_seats.sh || fail=1
echo "== db/tests/concurrency_club_event_pay.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_club_event_pay.sh || fail=1
echo "== db/tests/concurrency_fee_pay.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_fee_pay.sh || fail=1
echo "== db/tests/concurrency_payment_add.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_payment_add.sh || fail=1
echo "== db/tests/concurrency_player_save.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_player_save.sh || fail=1
echo "== db/tests/concurrency_group_since.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_group_since.sh || fail=1
echo "== db/tests/concurrency_match_rating.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_match_rating.sh || fail=1
echo "== db/tests/migration_match_rating.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/migration_match_rating.sh || fail=1
echo "== db/tests/concurrency_notifications_release.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_notifications_release.sh || fail=1
$PSQL -q -d postgres -c "drop database if exists $DB"
[ "$fail" = 0 ] && echo "Все тесты доступа прошли" || { echo "ЕСТЬ ПАДЕНИЯ"; exit 1; }
