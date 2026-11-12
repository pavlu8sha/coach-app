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
$PSQL -q -d postgres -c "drop database if exists $DB"
[ "$fail" = 0 ] && echo "Все тесты доступа прошли" || { echo "ЕСТЬ ПАДЕНИЯ"; exit 1; }
