#!/usr/bin/env bash
# Конкурентность идемпотентного возврата за сбор (миграция 0231, #721, docs/acceptance/camp-refund-idempotency-721-2026-11-27.md):
# параллельные запросы с одним ключом дают одну строку refund, один duplicate=false и остальные duplicate=true без ошибок;
# один ключ с разным содержимым не создаёт второй строки; разные ключи с одинаковым содержимым записываются все;
# при нехватке оплаченного лишние возвраты отклоняются и баланс не уходит в минус; откат первой транзакции не «съедает» повтор.
# Запуск из scripts/run-db-tests.sh после миграций.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
CL=00000000-0000-0000-0000-0000072100c1
AD=00000000-0000-0000-0000-0000072100a1
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$AD"; }
admin_sql() { { as; cat; } | $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" | tail -1; }
key() { printf '00000000-0000-0000-0000-0000721%05d' "$1"; }

N=6
q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность возврата 721');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990721, 'Админ', true);
insert into camps (club_id, name, starts_on, ends_on) select '$CL', 'Сбор-' || g, date '2099-01-01', date '2099-02-01' from generate_series(1, $N) g;
insert into camp_tariffs (camp_id, name, price) select id, 'Тариф', 1000 from camps where club_id = '$CL';
SQL
newpart() {  # $1 номер сбора: участник с оплатой 1000
  local c t p
  c=$(q -c "select id from camps where club_id = '$CL' and name = 'Сбор-$1'"); t=$(q -c "select id from camp_tariffs where camp_id = '$c'")
  p=$(echo "select camp_register_guest('$c', 'Гость $1', null, '$t', null, null, null);" | admin_sql)
  echo "select camp_pay('$p', 1000, 'payment', current_date, 'Наличные', null);" | admin_sql >/dev/null
  echo "$p"
}
paid() { q -c "select coalesce(sum(amount), 0) from camp_payments where participant_id = '$1'"; }
rcount() { q -c "select count(*) from camp_payments where participant_id = '$1' and kind = 'refund'"; }

# 1. Шесть одновременных повторов одного запроса
P=$(newpart 1); REQ=$(key 1)
for i in 1 2 3 4 5 6; do { as; echo "select pg_sleep(0.2); select camp_refund('$P', 400, current_date, 'r', '$REQ');"; } > "$T/a$i.sql"; done
for i in 1 2 3 4 5 6; do $PSQL -q -t -A -d "$DB" -f "$T/a$i.sql" > "$T/a$i.out" 2>&1 & done; wait
first=$(cat "$T"/a*.out | grep -c '"duplicate": false' || true)
dups=$(cat "$T"/a*.out | grep -c '"duplicate": true' || true)
errs=$(cat "$T"/a*.out | grep -c "ERROR" || true)
[ "$(rcount "$P")" = 1 ] && ok "один ключ: шесть одновременных запросов дали один возврат" || bad "один ключ: возвратов $(rcount "$P")"
[ "$first" = 1 ] && [ "$dups" = 5 ] && ok "один ключ: один duplicate=false, пять duplicate=true" || bad "один ключ: false=$first true=$dups"
[ "$errs" = 0 ] && ok "один ключ: ошибок нет" || { cat "$T"/a*.out; bad "один ключ: ошибок $errs"; }
[ "$(paid "$P")" = 600.00 ] && ok "один ключ: оплачено уменьшено один раз (600)" || bad "один ключ: оплачено $(paid "$P") вместо 600"

# 2. Повтор после возврата всего остатка, параллельно
P=$(newpart 2); REQ=$(key 2)
for i in 1 2 3 4; do { as; echo "select pg_sleep(0.2); select camp_refund('$P', 1000, current_date, null, '$REQ');"; } > "$T/f$i.sql"; done
for i in 1 2 3 4; do $PSQL -q -t -A -d "$DB" -f "$T/f$i.sql" > "$T/f$i.out" 2>&1 & done; wait
[ "$(rcount "$P")" = 1 ] && [ "$(paid "$P")" = 0.00 ] && ok "полный остаток: один возврат, оплачено 0, не в минус" || bad "полный остаток: возвратов $(rcount "$P"), оплачено $(paid "$P")"
[ "$(cat "$T"/f*.out | grep -c 'ERROR' || true)" = 0 ] && ok "полный остаток: повторы без ошибок (нет refund above paid)" || { cat "$T"/f*.out; bad "полный остаток: есть ошибки"; }

# 3. Один ключ, разное содержимое одновременно: строка одна, проигравший получает request id reused
P=$(newpart 3); REQ=$(key 3)
for i in 1 2; do { as; echo "select pg_sleep(0.2); select camp_refund('$P', 100 + $i, current_date, null, '$REQ');"; } > "$T/b$i.sql"; done
for i in 1 2; do $PSQL -q -t -A -d "$DB" -f "$T/b$i.sql" > "$T/b$i.out" 2>&1 & done; wait
[ "$(rcount "$P")" = 1 ] && ok "разное содержимое: возврат один" || bad "разное содержимое: возвратов $(rcount "$P")"
grep -q "request id reused" "$T"/b*.out && ok "разное содержимое: второй запрос отклонён (request id reused)" || bad "разное содержимое: нет отказа"

# 4. Разные ключи, одинаковое содержимое: самостоятельные возвраты, все записаны
P=$(newpart 4)
for i in 1 2 3 4; do { as; echo "select pg_sleep(0.2); select camp_refund('$P', 100, current_date, 'одинаковый', '$(key $((40 + i)))');"; } > "$T/c$i.sql"; done
for i in 1 2 3 4; do $PSQL -q -t -A -d "$DB" -f "$T/c$i.sql" > "$T/c$i.out" 2>&1 & done; wait
[ "$(rcount "$P")" = 4 ] && [ "$(paid "$P")" = 600.00 ] && ok "разные ключи: четыре одинаковых возврата записаны, оплачено 600" || bad "разные ключи: возвратов $(rcount "$P"), оплачено $(paid "$P")"
[ "$(cat "$T"/c*.out | grep -c '"duplicate": true' || true)" = 0 ] && ok "разные ключи: ни один не принят за повтор" || bad "разные ключи: есть duplicate=true"

# 5. Разные ключи, но оплаченного хватает на три из пяти: баланс не уходит в минус
P=$(newpart 5)
for i in 1 2 3 4 5; do { as; echo "select pg_sleep(0.2); select camp_refund('$P', 300, current_date, null, '$(key $((50 + i)))');"; } > "$T/d$i.sql"; done
for i in 1 2 3 4 5; do $PSQL -q -t -A -d "$DB" -f "$T/d$i.sql" > "$T/d$i.out" 2>&1 & done; wait
[ "$(rcount "$P")" = 3 ] && [ "$(paid "$P")" = 100.00 ] && ok "нехватка оплаченного: три возврата по 300, оплачено 100, не в минус" || bad "нехватка: возвратов $(rcount "$P"), оплачено $(paid "$P")"
[ "$(cat "$T"/d*.out | grep -c 'refund above paid' || true)" = 2 ] && ok "нехватка оплаченного: два лишних отклонены (refund above paid)" || bad "нехватка: отказов $(cat "$T"/d*.out | grep -c 'refund above paid' || true)"

# 6. Первая транзакция откатилась: повтор записывает возврат (параллельный запрос ждёт блокировку и пишет после отката)
P=$(newpart 6); REQ=$(key 6)
{ as; echo "begin; select camp_refund('$P', 250, current_date, null, '$REQ'); select pg_sleep(0.6); rollback;"; } > "$T/e1.sql"
{ as; echo "select pg_sleep(0.2); select camp_refund('$P', 250, current_date, null, '$REQ');"; } > "$T/e2.sql"
$PSQL -q -t -A -d "$DB" -f "$T/e1.sql" > "$T/e1.out" 2>&1 & A=$!
$PSQL -q -t -A -d "$DB" -f "$T/e2.sql" > "$T/e2.out" 2>&1 & B=$!
wait $A || true; wait $B || true
[ "$(rcount "$P")" = 1 ] && [ "$(paid "$P")" = 750.00 ] && ok "откат первой транзакции: повтор записал возврат один раз (оплачено 750)" || bad "откат: возвратов $(rcount "$P"), оплачено $(paid "$P")"
grep -q '"duplicate": false' "$T/e2.out" && ok "откат первой транзакции: повтор получил duplicate=false" || { cat "$T/e2.out"; bad "откат: повтор не записал возврат"; }

# 7. Итог по всему клубу: ни у одного участника оплаченное не отрицательно
neg=$(q -c "select count(*) from (select participant_id from camp_payments p join camps c on c.id = p.camp_id where c.club_id = '$CL' group by participant_id having sum(amount) < 0) x")
[ "$neg" = 0 ] && ok "инвариант: участников с отрицательной суммой нет" || bad "инвариант: участников с отрицательной суммой: $neg"
exit $fail
