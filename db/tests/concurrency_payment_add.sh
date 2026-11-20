#!/usr/bin/env bash
# Конкурентность payment_add (миграция 0214, #724): параллельные запросы с одним ключом дают одну строку payments,
# один ответ duplicate=false и остальные duplicate=true без ошибок; один ключ с разным содержимым не создаёт второй строки;
# разные ключи записываются все. Запуск из scripts/run-db-tests.sh после миграций.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
CL=00000000-0000-0000-0000-0000724000c1
AD=00000000-0000-0000-0000-0000724000a1
PL=00000000-0000-0000-0000-00007240d001
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$AD"; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность payment_add');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990724, 'Админ', true);
insert into players (id, club_id, full_name, status) values ('$PL', '$CL', 'Игрок', 'active');
SQL

# 1. Шесть одновременных повторов одного запроса
REQ=00000000-0000-0000-0000-000000724001
for i in 1 2 3 4 5 6; do { as; echo "select pg_sleep(0.2); select payment_add('$REQ', '$PL', 165, '2026-10-22', 'Перевод', '2026-11-01');"; } > "$T/a$i.sql"; done
for i in 1 2 3 4 5 6; do $PSQL -q -t -A -d "$DB" -f "$T/a$i.sql" > "$T/a$i.out" 2>&1 & done; wait
rows=$(q -c "select count(*) from payments where player_id = '$PL' and request_id = '$REQ'")
first=$(cat "$T"/a*.out | grep -c '"duplicate": false' || true)
dups=$(cat "$T"/a*.out | grep -c '"duplicate": true' || true)
errs=$(cat "$T"/a*.out | grep -c "ERROR" || true)
[ "$rows" = 1 ] && ok "один ключ: шесть одновременных запросов дали одну строку" || bad "один ключ: строк $rows"
[ "$first" = 1 ] && [ "$dups" = 5 ] && ok "один ключ: один duplicate=false, пять duplicate=true" || bad "один ключ: false=$first true=$dups"
[ "$errs" = 0 ] && ok "один ключ: ошибок нет" || { cat "$T"/a*.out; bad "один ключ: ошибок $errs"; }

# 2. Один ключ, разное содержимое одновременно: строка одна, проигравший получает request id reused
REQ2=00000000-0000-0000-0000-000000724002
for i in 1 2; do { as; echo "select pg_sleep(0.2); select payment_add('$REQ2', '$PL', 100 + $i, '2026-10-23', 'Наличные', null);"; } > "$T/b$i.sql"; done
for i in 1 2; do $PSQL -q -t -A -d "$DB" -f "$T/b$i.sql" > "$T/b$i.out" 2>&1 & done; wait
rows=$(q -c "select count(*) from payments where request_id = '$REQ2'")
[ "$rows" = 1 ] && ok "разное содержимое: строка одна" || bad "разное содержимое: строк $rows"
grep -q "request id reused" "$T"/b*.out && ok "разное содержимое: второй запрос отклонён (request id reused)" || bad "разное содержимое: нет отказа"

# 3. Разные ключи одновременно, одинаковое содержимое: все записаны
for i in 1 2 3 4; do { as; echo "select pg_sleep(0.2); select payment_add('00000000-0000-0000-0000-00000072410$i', '$PL', 50, '2026-10-24', 'Наличные', null);"; } > "$T/c$i.sql"; done
for i in 1 2 3 4; do $PSQL -q -t -A -d "$DB" -f "$T/c$i.sql" > "$T/c$i.out" 2>&1 & done; wait
rows=$(q -c "select count(*) from payments where player_id = '$PL' and paid_on = '2026-10-24'")
[ "$rows" = 4 ] && ok "разные ключи: четыре платежа записаны" || bad "разные ключи: строк $rows"

# 4. Итог: сумма платежей игрока = 165 + (100+i победителя) + 4*50
tot=$(q -c "select sum(amount) from payments where player_id = '$PL'")
exp=$(q -c "select 165 + (select amount from payments where request_id = '$REQ2') + 200")
[ "$tot" = "$exp" ] && ok "инвариант: сумма платежей = $exp, повторы ничего не добавили" || bad "инвариант: $tot вместо $exp"
exit $fail
