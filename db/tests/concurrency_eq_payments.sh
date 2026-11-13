#!/usr/bin/env bash
# Конкурентность журнала оплат экипировки (миграция 0188, #471 PR-2a): повтор с тем же ключом даёт одну строку, две оплаты
# сверх итога не проходят вместе, одну оплату нельзя сторнировать дважды. Запуск из scripts/run-db-tests.sh после миграций.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
CL=00000000-0000-0000-0000-0000ee0000c1
AD=00000000-0000-0000-0000-0000ee0000a1
PL=00000000-0000-0000-0000-0000ee00d001
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$AD"; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность оплат экипировки');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990701, 'Админ', true);
insert into players (id, club_id, full_name, status) values ('$PL', '$CL', 'Игрок', 'active');
insert into equipment_catalog (club_id, kit, price, valid_from) values ('$CL', 'Форма', 300, '2026-09-01');
SQL
mk() { { as; echo "select eq_create_order('$PL', '[{\"kit\":\"Форма\"}]'::jsonb, null, null, false, null);"; } | $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" | tail -1; }

# 1. Повтор с тем же ключом одновременно: одна строка журнала
O1=$(mk); REQ=00000000-0000-0000-0000-00000047e001
for i in 1 2 3 4; do { as; echo "select pg_sleep(0.1); select eq_add_payment('$O1', 100, null, 'Наличные', '$REQ');"; } > "$T/r$i.sql"; done
for i in 1 2 3 4; do $PSQL -q -d "$DB" -f "$T/r$i.sql" > "$T/r$i.out" 2>&1 & done; wait
rows=$(q -c "select count(*) from service_payments where ref_id = '$O1' and op = 'payment'")
paid=$(q -c "select paid from equipment_orders where id = '$O1'")
errs=$(cat "$T"/r*.out | grep -c "ERROR" || true)
[ "$rows" = 1 ] && ok "идемпотентность: четыре одновременных повтора дают одну строку" || bad "идемпотентность: строк $rows"
[ "$paid" = "100.00" ] && ok "идемпотентность: paid = 100" || bad "идемпотентность: paid $paid"
[ "$errs" = 0 ] && ok "идемпотентность: повторы возвращают результат без ошибок" || bad "идемпотентность: ошибок $errs"

# 2. Две оплаты с разными ключами, вместе больше итога: проходит только одна
O2=$(mk)
for i in 1 2; do { as; echo "select pg_sleep(0.1); select eq_add_payment('$O2', 200, null, 'Наличные', '00000000-0000-0000-0000-00000047e01$i');"; } > "$T/s$i.sql"; done
for i in 1 2; do $PSQL -q -d "$DB" -f "$T/s$i.sql" > "$T/s$i.out" 2>&1 & done; wait
paid=$(q -c "select paid from equipment_orders where id = '$O2'")
rows=$(q -c "select count(*) from service_payments where ref_id = '$O2'")
[ "$paid" = "200.00" ] && [ "$rows" = 1 ] && ok "переплата: из двух одновременных оплат сверх итога прошла одна" || bad "переплата: paid $paid, строк $rows"
grep -q "paid above total" "$T"/s*.out && ok "переплата: вторая отклонена с paid above total" || bad "переплата: нет отказа второй оплаты"

# 3. Одно сторно на одну оплату
PID=$(q -c "select id from service_payments where ref_id = '$O2'")
for i in 1 2 3; do { as; echo "select pg_sleep(0.1); select eq_reverse_payment('$PID', 'гонка $i', null);"; } > "$T/v$i.sql"; done
for i in 1 2 3; do $PSQL -q -d "$DB" -f "$T/v$i.sql" > "$T/v$i.out" 2>&1 & done; wait
rows=$(q -c "select count(*) from service_payments where cancels = '$PID'")
paid=$(q -c "select paid from equipment_orders where id = '$O2'")
[ "$rows" = 1 ] && [ "$paid" = "0.00" ] && ok "сторно: три одновременных сторно одной оплаты дали одну строку, paid = 0" || bad "сторно: строк $rows, paid $paid"

# 4. Инвариант: paid = сумма журнала по заказам прогона
bad_n=$(q -c "select count(*) from equipment_orders o where o.club_id = '$CL' and o.paid <> coalesce((select sum(amount) from service_payments where kind = 'equipment' and ref_id = o.id), 0)")
[ "$bad_n" = 0 ] && ok "инвариант: paid равен сумме журнала у всех заказов прогона" || bad "инвариант: расхождений $bad_n"
exit $fail
