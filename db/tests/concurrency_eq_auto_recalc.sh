#!/usr/bin/env bash
# Конкурентность автоматического пересчёта (миграция 0208, #652 этап 2b): создание, правка строки, отмена, дата заказа и ручной пересчёт
# одного ребёнка одновременно идут по очереди: без взаимных блокировок и ошибок, у ребёнка не более одной активной записи комплекта,
# итог каждого заказа равен строки + корректировка + скидка (И4), платежи не затронуты. Запуск из scripts/run-db-tests.sh после миграций.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
CL=00000000-0000-0000-0000-0000ee6522c1
AD=00000000-0000-0000-0000-0000ee6522a1
PL=00000000-0000-0000-0000-0000ee65d201
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$AD"; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность автопересчёта скидки');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990654, 'Админ', true);
insert into players (id, club_id, full_name, status) values ('$PL', '$CL', 'Игрок', 'active');
insert into equipment_catalog (club_id, kit, price, valid_from) values
  ('$CL', 'Игровая форма', 150, '2026-09-01'), ('$CL', 'Тренировочная форма', 150, '2026-09-01'),
  ('$CL', 'Спортивный костюм', 210, '2026-09-01'), ('$CL', 'Дождевик', 110, '2026-09-01');
insert into equipment_bundle_steps (step, note) values ('freeze_2c', 'тест конкурентности') on conflict do nothing;
SQL
O1=$( { as; echo "select eq_create_order('$PL', '[{\"kit\":\"Игровая форма\"},{\"kit\":\"Тренировочная форма\"}]'::jsonb, null, null, false, null);"; } | $PSQL -q -t -A -d "$DB" | tail -1)
O2=$( { as; echo "select eq_create_order('$PL', '[{\"kit\":\"Спортивный костюм\"},{\"kit\":\"Дождевик\"}]'::jsonb, null, null, false, null);"; } | $PSQL -q -t -A -d "$DB" | tail -1)
LN=$(q -c "select id from equipment_order_lines where order_id = '$O2' and kit = 'Дождевик'")
{ as; echo "select eq_add_payment('$O1', 100, null, 'Наличные');"; } | $PSQL -q -t -A -d "$DB" >/dev/null

# Параллельно: создание заказов (разные ключи), правка строки, дата, пересчёт, отмена нового заказа
for i in 1 2 3; do { as; echo "select pg_sleep(0.1); select eq_create_order('$PL', '[{\"kit\":\"Дождевик\"}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-00000652e20$i');"; } > "$T/c$i.sql"; done
for i in 1 2 3; do { as; echo "select pg_sleep(0.1); select eq_edit_line('$LN', 'M', $((i % 2 + 1)));"; } > "$T/e$i.sql"; done
for i in 1 2; do { echo "select pg_sleep(0.1); select eq_bundle_run('$PL'::uuid, 'manual', true, 'manual');"; } > "$T/m$i.sql"; done
{ as; echo "select pg_sleep(0.1); select eq_set_order_date('$O1', current_date - 3);"; } > "$T/d1.sql"
for f in c1 c2 c3 e1 e2 e3 m1 m2 d1; do $PSQL -q -t -A -d "$DB" -f "$T/$f.sql" > "$T/$f.out" 2>&1 & done; wait
errs=$(cat "$T"/*.out | grep -c "ERROR" || true)
[ "$errs" = 0 ] && ok "девять параллельных операций над одним ребёнком без ошибок и взаимных блокировок" || { bad "ошибок $errs"; cat "$T"/*.out | grep ERROR | head -3; }
bad_rows=$(q -c "select count(*) from equipment_orders o where o.player_id = '$PL' and (o.total <> eq_order_lines_sum(o.id) + o.manual_adjustment + o.bundle_adjustment or o.bundle_adjustment > 0)")
[ "$bad_rows" = 0 ] && ok "итог равен строки + корректировка + скидка (И4)" || bad "рассогласованных заказов $bad_rows"
act=$(q -c "select count(*) from equipment_bundles where player_id = '$PL' and state = 'active'")
[ "$act" -le 1 ] && ok "не более одной активной записи комплекта" || bad "активных записей $act"
disc=$(q -c "select count(*) from equipment_orders where player_id = '$PL' and bundle_adjustment < 0")
[ "$disc" -le 1 ] && ok "скидка стоит не более чем на одном заказе" || bad "заказов со скидкой $disc"
orders=$(q -c "select count(*) from equipment_orders where player_id = '$PL'")
[ "$orders" = 5 ] && ok "три заказа с разными ключами созданы (всего 5)" || bad "заказов $orders"
paid=$(q -c "select sum(paid) from equipment_orders where player_id = '$PL'")
[ "$paid" = 100.00 ] && ok "оплачено 100 осталось на месте (И1)" || bad "оплачено $paid"

# Удаление заказа против параллельной оплаты: допустим один исход, удалённого заказа с записью в service_payments быть не должно (замечание ревью PR #738)
# Оплата заказа берёт блокировку заказа и (через внешний ключ service_payments.player_id) KEY SHARE на строку ребёнка; удаление берёт игрока, затем заказ.
OD=$( { as; echo "select eq_create_order('$PL', '[{\"kit\":\"Дождевик\"}]'::jsonb, null, null, false, null, null, '00000000-0000-0000-0000-00000652d001');"; } | $PSQL -q -t -A -d "$DB" | tail -1)
{ as; echo "begin; select eq_add_payment('$OD', 20, null, 'Наличные'); select pg_sleep(1.5); commit;"; } > "$T/pay.sql"
{ as; echo "select pg_sleep(0.5); select eq_delete_order('$OD');"; } > "$T/del.sql"
$PSQL -q -t -A -d "$DB" -f "$T/pay.sql" > "$T/pay.out" 2>&1 &
$PSQL -q -t -A -d "$DB" -f "$T/del.sql" > "$T/del.out" 2>&1 &
wait
exists_o=$(q -c "select count(*) from equipment_orders where id = '$OD'")
pays=$(q -c "select count(*) from service_payments where kind = 'equipment' and ref_id = '$OD'")
if [ "$exists_o" = 0 ] && [ "$pays" != 0 ]; then bad "заказ удалён, а оплата осталась без заказа"
elif [ "$exists_o" = 1 ] && grep -q "order has payments" "$T/del.out"; then ok "удаление отклонено после записи оплаты, заказ и оплата на месте"
elif [ "$exists_o" = 0 ] && [ "$pays" = 0 ]; then ok "заказ удалён до оплаты, оплата отклонена"
else bad "неожиданный исход: заказ $exists_o, оплат $pays"; cat "$T/del.out" "$T/pay.out"; fi
exit $fail
