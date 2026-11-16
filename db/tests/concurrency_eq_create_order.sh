#!/usr/bin/env bash
# Конкурентность eq_create_order (миграция 0203, #652 этап 1): одновременные повторы с одним ключом дают один заказ и один id,
# разные ключи дают разные заказы. Запуск из scripts/run-db-tests.sh после миграций.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
CL=00000000-0000-0000-0000-0000ee6520c1
AD=00000000-0000-0000-0000-0000ee6520a1
PL=00000000-0000-0000-0000-0000ee65d001
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$AD"; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность создания заказа экипировки');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990652, 'Админ', true);
insert into players (id, club_id, full_name, status) values ('$PL', '$CL', 'Игрок', 'active');
insert into equipment_catalog (club_id, kit, price, valid_from) values ('$CL', 'Форма', 300, '2026-09-01');
SQL

# 1. Шесть одновременных вызовов с одним ключом: один заказ, один id, без ошибок
REQ=00000000-0000-0000-0000-00000652e001
for i in 1 2 3 4 5 6; do { as; echo "select pg_sleep(0.1); select eq_create_order('$PL', '[{\"kit\":\"Форма\",\"size\":\"M\"}]'::jsonb, null, null, false, null, null, '$REQ');"; } > "$T/r$i.sql"; done
for i in 1 2 3 4 5 6; do $PSQL -q -t -A -d "$DB" -f "$T/r$i.sql" > "$T/r$i.out" 2>&1 & done; wait
rows=$(q -c "select count(*) from equipment_orders where player_id = '$PL' and request_id = '$REQ'")
lines=$(q -c "select count(*) from equipment_order_lines l join equipment_orders o on o.id = l.order_id where o.request_id = '$REQ'")
ids=$(cat "$T"/r*.out | grep -E '^[0-9a-f]{8}-' | sort -u | wc -l | tr -d ' ')
errs=$(cat "$T"/r*.out | grep -c "ERROR" || true)
[ "$rows" = 1 ] && ok "шесть одновременных повторов дают один заказ" || bad "заказов $rows"
[ "$lines" = 1 ] && ok "у заказа одна строка" || bad "строк $lines"
[ "$ids" = 1 ] && ok "все вызовы вернули один и тот же id" || bad "разных id: $ids"
[ "$errs" = 0 ] && ok "повторы возвращают результат без ошибок" || bad "ошибок $errs"

# 2. Три разных ключа одновременно: три заказа
for i in 1 2 3; do { as; echo "select pg_sleep(0.1); select eq_create_order('$PL', '[{\"kit\":\"Форма\"}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-00000652e01$i');"; } > "$T/d$i.sql"; done
for i in 1 2 3; do $PSQL -q -t -A -d "$DB" -f "$T/d$i.sql" > "$T/d$i.out" 2>&1 & done; wait
rows=$(q -c "select count(*) from equipment_orders where player_id = '$PL' and request_id::text like '00000000-0000-0000-0000-00000652e01%'")
[ "$rows" = 3 ] && ok "три разных ключа дают три заказа" || bad "заказов по разным ключам: $rows"
exit $fail
