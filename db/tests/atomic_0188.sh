#!/usr/bin/env bash
# Атомарность миграции 0188 (#471 PR-2a): ошибка после отключения триггеров защиты журнала откатывает всю миграцию.
# Строится отдельная база из миграций до 0187, затем 0188 применяется с искусственной ошибкой; обычное применение даёт одну сводную запись аудита.
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL="${PSQL:-psql}"
DB="${DB_NAME:-kickstart_test}_atomic0188"
# shellcheck source=../../scripts/lib/local-db-guard.sh
. scripts/lib/local-db-guard.sh
local_db_guard "$PSQL" || exit 2
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
$PSQL -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
trap '$PSQL -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f db/tests/setup_local.sql >/dev/null
for f in db/migrations/*.sql; do
  case "$f" in *0188_*|*0189_*) continue ;; esac
  $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null 2>&1
done
CL=00000000-0000-0000-0000-0000ee0188c1; PL=00000000-0000-0000-0000-0000ee0188d1
q <<SQL
insert into clubs (id, name) values ('$CL', 'Атомарность 0188');
insert into players (id, club_id, full_name, status) values ('$PL', '$CL', 'Игрок', 'active');
insert into service_payments (kind, ref_id, player_id, amount, paid_on, method) values
  ('individual', gen_random_uuid(), '$PL', 100, '2026-09-01', 'Наличные'),
  ('individual', gen_random_uuid(), '$PL', -30, '2026-09-02', 'Наличные');
SQL
snap() { q -c "select md5(string_agg(id::text || amount::text || paid_on::text, ',' order by id)) from service_payments"; }
before=$(snap)
# Искусственная ошибка сразу после обратного включения первого триггера, то есть после UPDATE метки.
awk '/^alter table service_payments enable trigger service_payments_history_guard;/ && !d {print "select 1/0;"; d=1} {print}' db/migrations/0188_equipment_payment_journal.sql > /tmp/0188_broken_$$.sql
if $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f /tmp/0188_broken_$$.sql >/dev/null 2>&1; then bad "миграция с ошибкой не должна проходить"; else ok "миграция с искусственной ошибкой падает"; fi
rm -f /tmp/0188_broken_$$.sql
[ "$(q -c "select count(*) from information_schema.columns where table_name = 'service_payments' and column_name in ('op','request_id','note')")" = 0 ] && ok "откат: колонки op/request_id/note не созданы" || bad "откат: колонки остались"
[ "$(q -c "select count(*) from pg_trigger where tgrelid = 'public.service_payments'::regclass and tgname in ('service_payments_history_guard','service_payments_history_audit') and tgenabled = 'O'")" = 2 ] && ok "откат: оба триггера защиты журнала включены" || bad "откат: триггеры защиты не включены"
[ "$(snap)" = "$before" ] && ok "откат: строки журнала не изменились" || bad "откат: журнал изменился"
[ "$(q -c "select count(*) from audit_log where action = 'payment_op_backfill'")" = 0 ] && ok "откат: записи аудита нет" || bad "откат: запись аудита осталась"
# Обычное применение: одна сводная запись аудита с числом строк
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f db/migrations/0188_equipment_payment_journal.sql >/dev/null 2>&1 && ok "обычное применение проходит" || bad "обычное применение упало"
[ "$(q -c "select count(*) from audit_log where action = 'payment_op_backfill'")" = 1 ] && ok "одна сводная запись аудита" || bad "сводных записей аудита не одна"
[ "$(q -c "select after->>'rows' from audit_log where action = 'payment_op_backfill'")" = 2 ] && ok "в записи аудита число строк = 2" || bad "число строк в аудите неверное"
[ "$(q -c "select count(*) from pg_trigger where tgrelid = 'public.service_payments'::regclass and tgname in ('service_payments_history_guard','service_payments_history_audit') and tgenabled = 'O'")" = 2 ] && ok "после применения оба триггера включены" || bad "после применения триггеры выключены"
[ "$fail" = 0 ]
