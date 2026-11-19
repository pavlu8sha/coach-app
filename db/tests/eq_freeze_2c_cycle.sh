#!/usr/bin/env bash
# 0207 (#652 этап 2c), на закоммиченных данных: параллельные запуски eq_freeze_2c, цикл «применить -> откат -> применить повторно»,
# параллельное создание заказа во время заморозки, отказ отката после запуска расчёта.
# Запуск из scripts/run-db-tests.sh после миграций и до скриптов, создающих заказы через eq_create_order, и до concurrency_eq_bundle_recalc.sh (они оставляют запуски расчёта).
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
CL=00000000-0000-0000-0000-0000ee6621c1
AD=00000000-0000-0000-0000-0000ee6621a1
P1=00000000-0000-0000-0000-0000ee66d101
P2=00000000-0000-0000-0000-0000ee66d102
O1=00000000-0000-0000-0000-0000ee66e101
O2=00000000-0000-0000-0000-0000ee66e102
O3=00000000-0000-0000-0000-0000ee66e103
O4=00000000-0000-0000-0000-0000ee66e104
FB=00000000-0000-0000-0000-0000ee66fb01
ON=00000000-0000-0000-0000-0000ee66e1ff
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
snap() { q -c "select md5((select coalesce(string_agg(o::text, '|' order by o.id), '') from equipment_orders o) || '#' || (select count(*)::text from equipment_order_events) || '#' || (select count(*)::text from equipment_legacy_bundles) || '#' || (select count(*)::text from equipment_bundle_steps))"; }
drop_step() { q -c "alter table equipment_bundle_steps disable trigger equipment_bundle_steps_guard; delete from equipment_bundle_steps where step = 'freeze_2c'; alter table equipment_bundle_steps enable trigger equipment_bundle_steps_guard"; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Заморозка 2c: цикл');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990663, 'Админ', true);
insert into players (id, club_id, full_name, status) values ('$P1', '$CL', 'Игрок 1', 'active'), ('$P2', '$CL', 'Игрок 2', 'active');
insert into equipment_orders (id, club_id, player_id, ordered_on, installment, total, paid, created_at) values
  ('$O1', '$CL', '$P1', '2026-10-01', false, 0, 0, '2026-10-01 00:00+04'), ('$O2', '$CL', '$P1', '2026-10-05', false, 0, 0, '2026-10-05 00:00+04'),
  ('$O3', '$CL', '$P2', '2026-10-05', true, 0, 0, '2026-10-05 00:00+04'), ('$O4', '$CL', '$P2', '2026-10-06', true, 0, 0, '2026-10-06 00:00+04');
insert into equipment_order_lines (order_id, kit, size, quantity, unit_price) values
  ('$O1', 'Игровая форма', 'M', 1, 150), ('$O1', 'Тренировочная форма', 'M', 1, 150),
  ('$O2', 'Спортивный костюм', 'M', 1, 210), ('$O2', 'Дождевик', 'M', 1, 110), ('$O3', 'Носки', 'M', 1, 20), ('$O4', 'Носки', 'M', 1, 20);
update equipment_orders set total = 300 where id = '$O1';
update equipment_orders set total = 225 where id = '$O2';
update equipment_orders set total = 20 where id in ('$O3', '$O4');
SQL
as_admin() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n%s\n" "$AD" "$1"; }
# Отмена напрямую: eq_cancel_order с 0208 запускает автопересчёт и оставляет записи запусков, а тест 2c проверяет состояние «до пересчётов».
q -c "begin; select set_config('eq.op', 'cancel', true); update equipment_orders set status = 'cancelled', status_before_cancel = status, cancelled_at = now() where id = '$O4'; commit"
drop_step
S0=$(snap)

# 1. Четыре параллельных запуска: применяется один
for i in 1 2 3 4; do $PSQL -q -t -A -d "$DB" -c "select pg_sleep(0.1); select eq_freeze_2c('{}')" > "$T/f$i.out" 2>&1 & done; wait
errs=$(cat "$T"/f*.out | grep -c "ERROR" || true)
sk=$(cat "$T"/f*.out | grep -c "already applied" || true)
steps=$(q -c "select count(*) from equipment_bundle_steps where step = 'freeze_2c'")
b1=$(q -c "select count(*) from equipment_legacy_bundles where player_id = '$P1'")
[ "$errs" = 0 ] && ok "параллельные запуски без ошибок" || { bad "ошибок $errs"; grep ERROR "$T"/f*.out | head -3; }
[ "$sk" = 3 ] && [ "$steps" = 1 ] && ok "применился один запуск, три пропущены" || bad "пропущено $sk, отметок $steps"
[ "$b1" = 1 ] && ok "одна запись комплекта у ребёнка" || bad "записей комплекта: $b1"
frozen=$(q -c "select count(*) from equipment_orders where id in ('$O1', '$O2') and legacy_bundle_id is not null")
[ "$frozen" = 2 ] && ok "оба заказа комплекта заморожены" || bad "заморожено $frozen"
forf=$(q -c "select discount_forfeited from equipment_orders where id = '$O3'")
[ "$forf" = t ] && ok "заказ в рассрочку получил отказ от скидки" || bad "отказ у О3: $forf"
forf4=$(q -c "select discount_forfeited and status = 'cancelled' and installment from equipment_orders where id = '$O4'")
[ "$forf4" = t ] && ok "отменённый заказ в рассрочку получил отказ, остался отменённым и в рассрочке" || bad "отказ у отменённого О4: $forf4"
tot=$(q -c "select total from equipment_orders where id = '$O2'")
[ "$tot" = 225.00 ] && ok "итог О2 225.00 не изменился" || bad "итог $tot"

# 1b. Чужая запись комплекта с reason NULL: откат останавливается и ничего не меняет (проверка не пропускает NULL)
q -c "insert into equipment_legacy_bundles (id, player_id, kind, reason) values ('$FB', '$P2', 'review', null)"
SF=$(snap)
if $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f db/ops/rollback-0207-eq-freeze-2c.sql > "$T/rbf.out" 2>&1; then bad "откат с чужой записью (reason NULL) не должен выполняться"; else grep -q "rollback stopped" "$T/rbf.out" && ok "откат остановлен из-за чужой записи с NULL reason" || { bad "откат упал не по защите"; cat "$T/rbf.out"; }; fi
[ "$(snap)" = "$SF" ] && ok "остановленный откат ничего не изменил (чужая запись цела)" || bad "остановленный откат изменил состояние"
q -c "alter table equipment_legacy_bundles disable trigger equipment_legacy_bundles_guard; delete from equipment_legacy_bundles where id = '$FB'; alter table equipment_legacy_bundles enable trigger equipment_legacy_bundles_guard"

# 2. Откат возвращает состояние до 0207
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f db/ops/rollback-0207-eq-freeze-2c.sql > "$T/rb1.out" 2>&1 && ok "откат выполнен" || { bad "откат упал"; cat "$T/rb1.out"; }
[ "$(snap)" = "$S0" ] && ok "после отката состояние идентично исходному" || bad "состояние после отката отличается"
g2c=$(q -c "select position('forfeit_2c' in prosrc) from pg_proc where proname = 'eq_orders_guard'")
[ "$g2c" = 0 ] && ok "защита заказа возвращена к телу 0205 (без forfeit_2c)" || bad "в защите заказа осталась операция forfeit_2c"
fn=$(q -c "select count(*) from pg_proc where proname in ('eq_freeze_2c', 'eq_freeze_2c_fp')")
[ "$fn" = 0 ] && ok "функции 2c удалены откатом" || bad "функций осталось $fn"

# 3. Повторное применение: функции без блока применения (у миграции он с ожиданиями прода)
awk '/^do \$\$/{exit} {print}' db/migrations/0207_eq_freeze_2c.sql > "$T/funcs.sql"
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$T/funcs.sql" > /dev/null
q -c "select eq_freeze_2c('{}')" > "$T/again.out"
[ "$(q -c "select count(*) from equipment_bundle_steps where step = 'freeze_2c'")" = 1 ] && ok "повторное применение после отката: отметка есть" || bad "нет отметки"
S1=$(snap)
q -c "select eq_freeze_2c('{}')" | grep -q "already applied" && [ "$(snap)" = "$S1" ] && ok "второй запуск ничего не меняет" || bad "второй запуск изменил состояние"

# 4. Заказ, созданный во время заморозки, ждёт блокировку и в заморозку не попадает
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f db/ops/rollback-0207-eq-freeze-2c.sql > /dev/null 2>&1
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$T/funcs.sql" > /dev/null
{ echo "begin;"; echo "select eq_freeze_2c('{}') as note;"; echo "select pg_sleep(2);"; echo "commit;"; } > "$T/a.sql"
$PSQL -q -t -A -d "$DB" -f "$T/a.sql" > "$T/a.out" 2>&1 &
APID=$!
sleep 0.7
t0=$(date +%s.%N)
q -c "insert into equipment_orders (id, club_id, player_id, ordered_on, total, paid) values ('$ON', '$CL', '$P2', '2026-11-01', 0, 0)"
t1=$(date +%s.%N)
wait $APID
waited=$(awk -v a="$t0" -v b="$t1" 'BEGIN{print (b-a >= 1.0) ? "yes" : "no"}')
[ "$waited" = yes ] && ok "создание заказа ждало конца заморозки" || bad "создание заказа не ждало блокировку"
oc=$(grep -o '"orders_count": [0-9]*' "$T/a.out" | head -1 | awk '{print $2}')
nowc=$(q -c "select count(*) from equipment_orders")
[ -n "$oc" ] && [ "$oc" = "$((nowc - 1))" ] && ok "новый заказ не попал в снимок заморозки" || bad "orders_count $oc, заказов сейчас $nowc"
[ "$(q -c "select legacy_bundle_id is null and not discount_forfeited from equipment_orders where id = '$ON'")" = t ] && ok "новый заказ не заморожен" || bad "новый заказ заморожен"

# 5. После запуска расчёта откат отказывает (пересчёт с отпечатком предпросмотра)
printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\nselect eq_bundle_recalc('%s', 'manual', (eq_bundle_preview('%s'))->>'fingerprint');\n" "$AD" "$P1" "$P1" > "$T/rc.sql"
$PSQL -q -t -A -v ON_ERROR_STOP=1 -d "$DB" -f "$T/rc.sql" > "$T/rc.out" 2>&1 || { bad "ручной пересчёт упал"; cat "$T/rc.out"; }
S2=$(snap)
if $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f db/ops/rollback-0207-eq-freeze-2c.sql > "$T/rb2.out" 2>&1; then bad "откат после пересчёта не должен выполняться"; else grep -q "rollback stopped" "$T/rb2.out" && ok "откат после запуска расчёта остановлен" || { bad "откат упал не по защите"; cat "$T/rb2.out"; }; fi
[ "$(snap)" = "$S2" ] && ok "остановленный откат ничего не изменил" || bad "остановленный откат изменил состояние"
[ "$fail" = 0 ] || exit 1
