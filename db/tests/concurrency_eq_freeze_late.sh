#!/usr/bin/env bash
# Конкурентность db/ops/eq-freeze-2c-late.sql и отката: проверка «расчётов не было» выполняется под блокировками, а не до них.
# Транзакция A (имитация расчёта) держит блокировку заказов и пишет запись запуска; скрипт B стартует во время A и ждёт блокировку.
# После фиксации A скрипт B обязан увидеть запуск и остановиться (до исправления он проверял до блокировки и замораживал после расчёта).
# Работает на копии базы (шаблон), чтобы запуски расчётов не мешали остальным тестам. Запуск из scripts/run-db-tests.sh.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
CP="${DB}_latecc"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$CP" "$@"; }
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d)
cleanup() { $PSQL -q -d postgres -c "drop database if exists $CP" >/dev/null 2>&1 || true; rm -rf "$T"; }
trap cleanup EXIT
$PSQL -q -d postgres -c "drop database if exists $CP" -c "create database $CP template $DB"
# Копия содержит следы прежних тестов (запуски расчёта, заказы): чистим данные экипировки, иначе проверка «расчётов не было» срабатывала бы сама по себе
q <<'SQL'
alter table equipment_order_events disable trigger user;
alter table equipment_order_lines disable trigger user;
alter table equipment_orders disable trigger user;
alter table equipment_bundle_status disable trigger user;
alter table equipment_bundle_runs disable trigger user;
alter table equipment_bundles disable trigger user;
alter table equipment_legacy_bundles disable trigger user;
truncate equipment_bundle_status, equipment_bundle_runs, equipment_bundles, equipment_legacy_bundles, equipment_order_events, equipment_order_lines, equipment_orders cascade;
delete from service_payments where kind = 'equipment';
alter table equipment_order_events enable trigger user;
alter table equipment_order_lines enable trigger user;
alter table equipment_orders enable trigger user;
alter table equipment_bundle_status enable trigger user;
alter table equipment_bundle_runs enable trigger user;
alter table equipment_bundles enable trigger user;
alter table equipment_legacy_bundles enable trigger user;
SQL
CL=00000000-0000-0000-0000-0000ee7721c1
PL=00000000-0000-0000-0000-0000ee77d101
O1=00000000-0000-0000-0000-0000ee77e101
O2=00000000-0000-0000-0000-0000ee77e102
BX=00000000-0000-0000-0000-0000ee77b101
q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность позднего окна');
insert into players (id, club_id, full_name, status) values ('$PL', '$CL', 'Игрок', 'active');
insert into equipment_bundle_steps (step, note) values ('freeze_2c', 'тест') on conflict do nothing;
insert into equipment_orders (id, club_id, player_id, ordered_on, total, paid, created_at) values
  ('$O1', '$CL', '$PL', '2026-10-01', 0, 0, '2026-10-01 10:00+04'), ('$O2', '$CL', '$PL', '2026-10-05', 0, 0, '2026-10-05 10:00+04');
insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values
  ('$O1', 'Игровая форма', 'M', 1, 150), ('$O1', 'Тренировочная форма', 'M', 1, 150),
  ('$O2', 'Спортивный костюм', 'M', 1, 210), ('$O2', 'Дождевик', 'M', 1, 110);
update equipment_orders set total = 300 where id = '$O1';
update equipment_orders set total = 225 where id = '$O2';
SQL
# Расчётов нет, заказ O2 — единственный кандидат (скидка 95 в итоге)
cnt=$(q -c "select count(*) from equipment_orders where legacy_bundle_id is null and manual_adjustment < 0 and player_id = '$PL'")
[ "$cnt" = 1 ] && ok "подготовка: один кандидат" || bad "кандидатов $cnt"
sed -e "s/b8fbdf08-c24d-4df2-97de-da206c0a8dc3/$O2/" -e "s/627b9bee-5472-4061-8fd5-9c0d5af54042/$BX/" db/ops/eq-freeze-2c-late.sql > "$T/apply.sql"
sed -e "s/627b9bee-5472-4061-8fd5-9c0d5af54042/$BX/" -e "s/be1e9ce5-4472-4248-a686-04027d0c200c/$PL/" -e "s/array\['b8fbdf08-c24d-4df2-97de-da206c0a8dc3'\]/array['$O1','$O2']/" db/ops/rollback-eq-freeze-2c-late.sql > "$T/rollback.sql"
# Только заказы текущего теста: остальные кандидаты в базе из шаблона учитываются скриптом, поэтому проверяем, что их нет
other=$(q -c "select count(*) from equipment_orders where legacy_bundle_id is null and status <> 'cancelled' and manual_adjustment < 0 and id <> '$O2'")
[ "$other" = 0 ] || { bad "в шаблонной базе есть посторонние кандидаты ($other)"; exit 1; }

# A: расчёт (запись запуска) удерживает блокировку заказов 3 секунды; B стартует через 1 секунду и ждёт
race() { # $1 скрипт B, $2 вывод
  { echo "begin; update equipment_orders set location = location where id = '$O1';"
    echo "insert into equipment_bundle_runs (player_id, mode, trigger_reason, input, output) values ('$PL', 'manual', 'гонка', '{}'::jsonb, '{}'::jsonb);"
    echo "select pg_sleep(3); commit;"; } > "$T/a.sql"
  $PSQL -q -t -A -d "$CP" -f "$T/a.sql" > "$T/a.out" 2>&1 &
  local pa=$!
  sleep 1
  $PSQL -q -t -A -d "$CP" -f "$1" > "$2" 2>&1 || true
  wait $pa
}
race "$T/apply.sql" "$T/b1.out"
grep -q "recalculation was already run" "$T/b1.out" && ok "заморозка: расчёт, завершившийся во время ожидания блокировки, замечен (остановка)" || { bad "заморозка не остановилась"; cat "$T/b1.out" | head -3; }
fz=$(q -c "select count(*) from equipment_orders where legacy_bundle_id is not null and player_id = '$PL'")
[ "$fz" = 0 ] && ok "заморозка: ничего не заморожено" || bad "заморожено $fz"
# Откат: сначала настоящая заморозка (чистим запись гонки), затем гонка с откатом
q -c "alter table equipment_bundle_status disable trigger user" -c "alter table equipment_bundle_runs disable trigger user" -c "delete from equipment_bundle_status" -c "delete from equipment_bundle_runs" -c "alter table equipment_bundle_runs enable trigger user" -c "alter table equipment_bundle_status enable trigger user"
$PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$CP" -f "$T/apply.sql" > "$T/b2.out" 2>&1 && ok "заморозка без гонки отработала" || { bad "заморозка не отработала"; head -3 "$T/b2.out"; }
race "$T/rollback.sql" "$T/b3.out"
grep -q "recalculation was run after the late freeze" "$T/b3.out" && ok "откат: расчёт во время ожидания блокировки замечен (остановка)" || { bad "откат не остановился"; head -3 "$T/b3.out"; }
fz=$(q -c "select count(*) from equipment_orders where legacy_bundle_id is not null and player_id = '$PL'")
[ "$fz" = 2 ] && ok "откат: заказы остались замороженными" || bad "заморожено $fz"
exit $fail
