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
  bad=$(printf '%s\n' "$pf" | awk -F'|' '$1 ~ /^[0-9]{4}_/ && $3 != "APPLIED" && $3 != "SUPERSEDED" {print}')
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
preflight_partial "без 0202 и 0204" '0202_club_events|0204_club_event_participants' 0202_club_events 0204_club_event_participants
preflight_partial "без 0204" '0204_club_event_participants' 0204_club_event_participants
for t in db/tests/*_test.sql; do
  echo "== $t"
  out=$($PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t" 2>&1) || { echo "$out"; fail=1; continue; }
  echo "$out" | grep -E '^ *(ok|not ok) ' || true
  if echo "$out" | grep -qE 'not ok|Looks like you (failed|planned)'; then echo "$out"; fail=1; fi
done
echo "== db/tests/concurrency_match_rsvp.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_match_rsvp.sh || fail=1
echo "== db/tests/concurrency_booking.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_booking.sh || fail=1
echo "== db/tests/concurrency_consent_versions.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_consent_versions.sh || fail=1
echo "== db/tests/concurrency_camp_seats.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_camp_seats.sh || fail=1
echo "== db/tests/concurrency_camp_applications.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_camp_applications.sh || fail=1
echo "== db/tests/concurrency_camp_refund.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_camp_refund.sh || fail=1
echo "== db/tests/concurrency_consent_record.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_consent_record.sh || fail=1
echo "== db/tests/concurrency_consent_claim.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_consent_claim.sh || fail=1
echo "== db/tests/concurrency_eq_payments.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_eq_payments.sh || fail=1
echo "== db/tests/concurrency_eq_create_order.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_eq_create_order.sh || fail=1
echo "== db/tests/atomic_0188.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/atomic_0188.sh || fail=1
echo "== db/tests/concurrency_club_event_seats.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_club_event_seats.sh || fail=1
echo "== db/tests/concurrency_notifications_release.sh"
DB_NAME="$DB" PSQL="$PSQL" db/tests/concurrency_notifications_release.sh || fail=1
$PSQL -q -d postgres -c "drop database if exists $DB"
[ "$fail" = 0 ] && echo "Все тесты доступа прошли" || { echo "ЕСТЬ ПАДЕНИЯ"; exit 1; }
