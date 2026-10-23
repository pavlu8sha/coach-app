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
for t in db/tests/rls*_test.sql; do
  echo "== $t"
  out=$($PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t" 2>&1) || { echo "$out"; fail=1; continue; }
  echo "$out" | grep -E '^ *(ok|not ok) ' || true
  if echo "$out" | grep -qE 'not ok|Looks like you (failed|planned)'; then echo "$out"; fail=1; fi
done
$PSQL -q -d postgres -c "drop database if exists $DB"
[ "$fail" = 0 ] && echo "Все тесты доступа прошли" || { echo "ЕСТЬ ПАДЕНИЯ"; exit 1; }
