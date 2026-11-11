#!/usr/bin/env bash
# Прогон миграций и pgTAP-тестов доступа на чистой локальной БД PostgreSQL (без Supabase).
# Нужны: PostgreSQL 16 с расширением pgTAP. Запуск: PGUSER=postgres scripts/run-db-tests.sh
# Переменные: DB_NAME (по умолчанию kickstart_test), PSQL (по умолчанию "psql").
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"

$PSQL -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }

run db/tests/setup_local.sql
for f in db/migrations/*.sql; do
  echo "== $f"; run "$f"
done

fail=0
# preflight.sql должен выполняться и показывать все миграции применёнными (ловит сломанный синтаксис после слияний).
# Известное исключение: признаки 0047 и 0052 перекрыты более поздними миграциями, на полной базе они показывают f.
echo "== db/ops/preflight.sql"
pf=$($PSQL -q -At -v ON_ERROR_STOP=1 -d "$DB" -f db/ops/preflight.sql 2>&1 | grep -vE '^(0047_ind_no_autobook|0052_ind_change_type)\|f$'; exit "${PIPESTATUS[0]}") || { echo "$pf"; echo "not ok - preflight.sql не выполняется"; fail=1; }
if echo "$pf" | grep -qE '\|f$'; then echo "$pf" | grep -E '\|f$'; echo "not ok - preflight.sql: есть миграции без отметки applied"; fail=1; fi
[ "$fail" = 0 ] && echo "ok - preflight.sql выполняется, все миграции applied ($(echo "$pf" | grep -cE '\|t$'))"
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
