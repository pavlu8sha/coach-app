#!/usr/bin/env bash
# Конкурентность eq_bundle_recalc (миграция 0205, #652 этап 2a): одновременные пересчёты одного ребёнка сериализуются,
# остаётся одна активная запись комплекта и одна скидка; параллельная правка строки не ломает равенство итога (И4).
# Запуск из scripts/run-db-tests.sh после миграций.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
CL=00000000-0000-0000-0000-0000ee6521c1
AD=00000000-0000-0000-0000-0000ee6521a1
PL=00000000-0000-0000-0000-0000ee65d101
O1=00000000-0000-0000-0000-0000ee65e101
O2=00000000-0000-0000-0000-0000ee65e102
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$AD"; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность пересчёта скидки');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990653, 'Админ', true);
insert into players (id, club_id, full_name, status) values ('$PL', '$CL', 'Игрок', 'active');
insert into equipment_bundle_steps (step, note) values ('freeze_2c', 'тест конкурентности') on conflict do nothing;
insert into equipment_orders (id, club_id, player_id, ordered_on, total, paid, created_at) values
  ('$O1', '$CL', '$PL', '2026-10-01', 0, 0, '2026-10-01 10:00+04'), ('$O2', '$CL', '$PL', '2026-10-05', 0, 0, '2026-10-05 10:00+04');
insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values
  ('$O1', 'Игровая форма', 'M', 1, 150), ('$O1', 'Тренировочная форма', 'M', 1, 150),
  ('$O2', 'Спортивный костюм', 'M', 1, 210), ('$O2', 'Дождевик', 'M', 1, 110);
update equipment_orders set total = 300 where id = '$O1';
update equipment_orders set total = 320 where id = '$O2';
SQL

# 1. Шесть одновременных пересчётов
for i in 1 2 3 4 5 6; do { as; echo "select pg_sleep(0.1); select eq_bundle_recalc('$PL');"; } > "$T/r$i.sql"; done
for i in 1 2 3 4 5 6; do $PSQL -q -t -A -d "$DB" -f "$T/r$i.sql" > "$T/r$i.out" 2>&1 & done; wait
errs=$(cat "$T"/r*.out | grep -c "ERROR" || true)
act=$(q -c "select count(*) from equipment_bundles where player_id = '$PL' and state = 'active'")
all=$(q -c "select count(*) from equipment_bundles where player_id = '$PL'")
tot=$(q -c "select total from equipment_orders where id = '$O2'")
ev=$(q -c "select count(*) from equipment_order_events where order_id = '$O2' and event = 'recalc'")
runs=$(q -c "select count(*) from equipment_bundle_runs where player_id = '$PL'")
[ "$errs" = 0 ] && ok "параллельные пересчёты без ошибок" || { bad "ошибок $errs"; cat "$T"/r*.out | grep ERROR | head -3; }
[ "$act" = 1 ] && [ "$all" = 1 ] && ok "одна запись комплекта" || bad "записей комплекта: active $act, всего $all"
[ "$tot" = 225.00 ] && ok "скидка 95 применена один раз (итог 225.00)" || bad "итог $tot"
[ "$ev" = 1 ] && ok "одно событие пересчёта" || bad "событий $ev"
[ "$runs" = 6 ] && ok "шесть записей журнала запусков" || bad "запусков $runs"

# 2. Параллельно: правка количества строки и пересчёт; после всего итог сохраняет равенство
LN=$(q -c "select id from equipment_order_lines where order_id = '$O2' and kit = 'Дождевик'")
for i in 1 2 3; do { as; echo "select pg_sleep(0.1); select eq_bundle_recalc('$PL');"; } > "$T/m$i.sql"; done
for i in 1 2 3; do { as; echo "select pg_sleep(0.1); select eq_edit_line('$LN', 'M', $((i % 2 + 1)));"; } > "$T/e$i.sql"; done
for f in m1 m2 m3 e1 e2 e3; do $PSQL -q -t -A -d "$DB" -f "$T/$f.sql" > "$T/$f.out" 2>&1 & done; wait
errs=$(cat "$T"/m*.out "$T"/e*.out | grep -c "ERROR" || true)
bad_rows=$(q -c "select count(*) from equipment_orders o where o.player_id = '$PL' and o.total <> eq_order_lines_sum(o.id) + o.manual_adjustment + o.bundle_adjustment")
[ "$errs" = 0 ] && ok "правка и пересчёт параллельно без ошибок и взаимных блокировок" || { bad "ошибок $errs"; cat "$T"/m*.out "$T"/e*.out | grep ERROR | head -3; }
[ "$bad_rows" = 0 ] && ok "итог равен строкам + корректировка + скидка (И4)" || bad "рассогласованных заказов $bad_rows"
exit $fail
