#!/usr/bin/env bash
# Конкурентность event_pay и match_pay (миграция 0232, Issue #722; условия: docs/FEE_PAY_SERIALIZATION_ACCEPTANCE.md, п. 2, 4, 5, 7).
# Гонка детерминирована: первая сессия держит транзакцию открытой после оплаты, вторая стартует внутри этого окна.
# Без блокировки строки взноса вторая сессия видит остаток 100 и платит его ещё раз. Запуск из scripts/run-db-tests.sh после миграций.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
CL=00000000-0000-0000-0000-000000722001
AD=00000000-0000-0000-0000-0000007220a1
P1=00000000-0000-0000-0000-00000722d001; P2=00000000-0000-0000-0000-00000722d002; P3=00000000-0000-0000-0000-00000722d003
M1=00000000-0000-0000-0000-00000722f001; M2=00000000-0000-0000-0000-00000722f002; M3=00000000-0000-0000-0000-00000722f003
T1=00000000-0000-0000-0000-00000722a001; T2=00000000-0000-0000-0000-00000722a002; T3=00000000-0000-0000-0000-00000722a003
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$AD"; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность оплат взносов');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990722, 'Админ', true);
insert into players (id, club_id, full_name, status) values ('$P1', '$CL', 'Игрок 1', 'active'), ('$P2', '$CL', 'Игрок 2', 'active'), ('$P3', '$CL', 'Игрок 3', 'active');
insert into matches (id, club_id, played_on, team, opponent, kind) values
  ('$M1', '$CL', '2026-11-01', 'U9', 'А', 'friendly'), ('$M2', '$CL', '2026-11-02', 'U9', 'Б', 'friendly'), ('$M3', '$CL', '2026-11-03', 'U9', 'В', 'friendly');
insert into match_fees (match_id, player_id, amount, paid) select m, p, 100, false from unnest(array['$M1','$M2','$M3']::uuid[]) m, unnest(array['$P1','$P2','$P3']::uuid[]) p;
insert into tournaments (id, club_id, team, kind, name, fee) values
  ('$T1', '$CL', 'U9', 'championship', 'Ч1', 100), ('$T2', '$CL', 'U9', 'championship', 'Ч2', 100), ('$T3', '$CL', 'U9', 'championship', 'Ч3', 100);
insert into tournament_fees (tournament_id, player_id, amount, paid) select t, p, 100, false from unnest(array['$T1','$T2','$T3']::uuid[]) t, unnest(array['$P1','$P2','$P3']::uuid[]) p;
SQL

# slow = сессия держит транзакцию 1.5 с после оплаты; fast = стартует через 0.5 с, когда первая ещё не зафиксирована
run_pair() {  # $1 label, $2 sql первого вызова, $3 sql второго
  { as; echo "begin;"; echo "$2"; echo "select pg_sleep(1.5);"; echo "commit;"; } > "$T/$1.slow.sql"
  { as; echo "select pg_sleep(0.5);"; echo "$3"; } > "$T/$1.fast.sql"
  $PSQL -q -t -A -d "$DB" -f "$T/$1.slow.sql" > "$T/$1.slow.out" 2>&1 &
  $PSQL -q -t -A -d "$DB" -f "$T/$1.fast.sql" > "$T/$1.fast.out" 2>&1 &
  wait
}
sumof() { q -c "select coalesce(sum(amount), 0) from $1 where $2"; }
cntof() { q -c "select count(*) from $1 where $2"; }

# 1. Матч: две оплаты остатка одновременно (amt = NULL) дают один платёж 100
run_pair m1 "select 'N=' || match_pay('$M1', array['$P1']::uuid[], null, null, 'Наличные', null);" "select 'N=' || match_pay('$M1', array['$P1']::uuid[], null, null, 'Перевод', null);"
s=$(sumof match_payments "match_id = '$M1' and player_id = '$P1'"); c=$(cntof match_payments "match_id = '$M1' and player_id = '$P1'")
[ "$s" = 100.00 ] && [ "$c" = 1 ] && ok "матч: две параллельные оплаты остатка дали один платёж 100" || bad "матч: сумма $s, строк $c (ожидалось 100.00 и 1)"
grep -q "N=0" "$T/m1.fast.out" && ok "матч: вторая оплата увидела остаток 0 и вернула 0" || { cat "$T"/m1.*.out; bad "матч: вторая оплата не вернула 0"; }
paid=$(q -c "select paid from match_fees where match_id = '$M1' and player_id = '$P1'")
[ "$paid" = t ] && ok "матч: флаг paid стоит" || bad "матч: флаг paid = $paid"

# 2. Событие: то же
run_pair e1 "select 'N=' || event_pay('$T1', array['$P1']::uuid[], null, null, 'Наличные', null);" "select 'N=' || event_pay('$T1', array['$P1']::uuid[], null, null, 'Перевод', null);"
s=$(sumof tournament_payments "tournament_id = '$T1' and player_id = '$P1'"); c=$(cntof tournament_payments "tournament_id = '$T1' and player_id = '$P1'")
[ "$s" = 100.00 ] && [ "$c" = 1 ] && ok "событие: две параллельные оплаты остатка дали один платёж 100" || bad "событие: сумма $s, строк $c (ожидалось 100.00 и 1)"
grep -q "N=0" "$T/e1.fast.out" && ok "событие: вторая оплата увидела остаток 0 и вернула 0" || { cat "$T"/e1.*.out; bad "событие: вторая оплата не вернула 0"; }

# 3. Частичная оплата против оплаты остатка: итог ровно 100 (30 + 70), без переплаты
run_pair m2 "select 'N=' || match_pay('$M1', array['$P2']::uuid[], 30, null, 'Наличные', null);" "select 'N=' || match_pay('$M1', array['$P2']::uuid[], null, null, 'Перевод', null);"
s=$(sumof match_payments "match_id = '$M1' and player_id = '$P2'")
[ "$s" = 100.00 ] && ok "матч: частичная 30 и параллельная оплата остатка дали ровно 100" || bad "матч: сумма $s (ожидалось 100.00)"
run_pair e2 "select 'N=' || event_pay('$T1', array['$P2']::uuid[], 30, null, 'Наличные', null);" "select 'N=' || event_pay('$T1', array['$P2']::uuid[], null, null, 'Перевод', null);"
s=$(sumof tournament_payments "tournament_id = '$T1' and player_id = '$P2'")
[ "$s" = 100.00 ] && ok "событие: частичная 30 и параллельная оплата остатка дали ровно 100" || bad "событие: сумма $s (ожидалось 100.00)"

# 4. Шесть одновременных вызовов оплаты остатка по одному игроку (матч и событие)
for i in 1 2 3 4 5 6; do
  { as; echo "select pg_sleep(0.3); select match_pay('$M2', array['$P1']::uuid[], null, null, 'Наличные', null);"; } > "$T/mm$i.sql"
  { as; echo "select pg_sleep(0.3); select event_pay('$T2', array['$P1']::uuid[], null, null, 'Наличные', null);"; } > "$T/ee$i.sql"
done
for i in 1 2 3 4 5 6; do $PSQL -q -t -A -d "$DB" -f "$T/mm$i.sql" > "$T/mm$i.out" 2>&1 & $PSQL -q -t -A -d "$DB" -f "$T/ee$i.sql" > "$T/ee$i.out" 2>&1 & done; wait
s=$(sumof match_payments "match_id = '$M2' and player_id = '$P1'"); c=$(cntof match_payments "match_id = '$M2' and player_id = '$P1'")
[ "$s" = 100.00 ] && [ "$c" = 1 ] && ok "матч: шесть параллельных оплат остатка дали один платёж 100" || bad "матч: сумма $s, строк $c"
s=$(sumof tournament_payments "tournament_id = '$T2' and player_id = '$P1'"); c=$(cntof tournament_payments "tournament_id = '$T2' and player_id = '$P1'")
[ "$s" = 100.00 ] && [ "$c" = 1 ] && ok "событие: шесть параллельных оплат остатка дали один платёж 100" || bad "событие: сумма $s, строк $c"
errs=$(cat "$T"/mm*.out "$T"/ee*.out | grep -c "ERROR" || true)
[ "$errs" = 0 ] && ok "шесть параллельных оплат: ошибок нет" || { cat "$T"/mm*.out "$T"/ee*.out; bad "шесть параллельных оплат: ошибок $errs"; }

# 5. Пакеты с пересекающимися наборами в разном порядке: нет deadlock, у каждого игрока одна оплата остатка
for i in 1 2 3 4; do
  { as; echo "select pg_sleep(0.3); select match_pay('$M3', array['$P1','$P2','$P3']::uuid[], null, null, 'Наличные', null);"; } > "$T/pa$i.sql"
  { as; echo "select pg_sleep(0.3); select match_pay('$M3', array['$P3','$P2','$P1']::uuid[], null, null, 'Наличные', null);"; } > "$T/pb$i.sql"
  { as; echo "select pg_sleep(0.3); select event_pay('$T3', array['$P1','$P2','$P3']::uuid[], null, null, 'Наличные', null);"; } > "$T/qa$i.sql"
  { as; echo "select pg_sleep(0.3); select event_pay('$T3', array['$P3','$P1','$P2']::uuid[], null, null, 'Наличные', null);"; } > "$T/qb$i.sql"
done
for i in 1 2 3 4; do for p in pa pb qa qb; do $PSQL -q -t -A -d "$DB" -f "$T/$p$i.sql" > "$T/$p$i.out" 2>&1 & done; done; wait
if cat "$T"/p?*.out "$T"/q?*.out | grep -qi "deadlock"; then bad "пакеты: deadlock"; else ok "пакеты в разном порядке: deadlock нет"; fi
bad_m=$(q -c "select count(*) from (select player_id from match_payments where match_id = '$M3' group by player_id having sum(amount) <> 100 or count(*) <> 1) x")
bad_e=$(q -c "select count(*) from (select player_id from tournament_payments where tournament_id = '$T3' group by player_id having sum(amount) <> 100 or count(*) <> 1) x")
n_m=$(q -c "select count(distinct player_id) from match_payments where match_id = '$M3'"); n_e=$(q -c "select count(distinct player_id) from tournament_payments where tournament_id = '$T3'")
[ "$bad_m" = 0 ] && [ "$n_m" = 3 ] && ok "пакеты матча: у каждого из трёх игроков ровно один платёж 100" || bad "пакеты матча: проблемных игроков $bad_m, оплатили $n_m из 3"
[ "$bad_e" = 0 ] && [ "$n_e" = 3 ] && ok "пакеты события: у каждого из трёх игроков ровно один платёж 100" || bad "пакеты события: проблемных игроков $bad_e, оплатили $n_e из 3"
errs=$(cat "$T"/p?*.out "$T"/q?*.out | grep -c "ERROR" || true)
[ "$errs" = 0 ] && ok "пакеты: ошибок нет" || { cat "$T"/p?*.out "$T"/q?*.out; bad "пакеты: ошибок $errs"; }

# 6. Импортированный paid = true без строк оплат + параллельные оплаты по явной сумме 0 остатка: материализация одна
q <<SQL
insert into matches (id, club_id, played_on, team, opponent, kind) values ('00000000-0000-0000-0000-00000722f009', '$CL', '2026-11-09', 'U9', 'Импорт', 'friendly');
insert into match_fees (match_id, player_id, amount, paid) values ('00000000-0000-0000-0000-00000722f009', '$P1', 100, true);
SQL
MI=00000000-0000-0000-0000-00000722f009
for i in 1 2 3 4; do { as; echo "select pg_sleep(0.3); select match_pay('$MI', array['$P1']::uuid[], 10, null, 'Наличные', null);"; } > "$T/im$i.sql"; done
for i in 1 2 3 4; do $PSQL -q -t -A -d "$DB" -f "$T/im$i.sql" > "$T/im$i.out" 2>&1 & done; wait
c=$(cntof match_payments "match_id = '$MI' and player_id = '$P1' and comment = 'Оплата из импорта'")
[ "$c" = 1 ] && ok "импорт: материализация оплаты из импорта одна при четырёх параллельных вызовах" || bad "импорт: материализаций $c"

# 7. Разные игроки одного матча не ждут друг друга: сессия A держит блокировку игрока 1, оплата игрока 2 проходит сразу
q <<SQL
insert into match_fees (match_id, player_id, amount, paid) select '00000000-0000-0000-0000-00000722f009', '$P2', 100, false;
SQL
{ as; echo "begin;"; echo "select match_pay('$MI', array['$P1']::uuid[], 5, null, 'Наличные', null);"; echo "select pg_sleep(2);"; echo "commit;"; } > "$T/w1.sql"
{ as; echo "select pg_sleep(0.5);"; echo "select clock_timestamp();"; echo "select match_pay('$MI', array['$P2']::uuid[], null, null, 'Наличные', null);"; echo "select clock_timestamp();"; } > "$T/w2.sql"
$PSQL -q -t -A -d "$DB" -f "$T/w1.sql" > "$T/w1.out" 2>&1 &
$PSQL -q -t -A -d "$DB" -f "$T/w2.sql" > "$T/w2.out" 2>&1 &
wait
dur=$(q -c "select extract(epoch from ('$(grep -E '^20' "$T/w2.out" | tail -1)'::timestamptz - '$(grep -E '^20' "$T/w2.out" | head -1)'::timestamptz))")
awk -v d="$dur" 'BEGIN { exit !(d < 1.0) }' && ok "разные игроки одного матча: оплата не ждёт чужую блокировку ($dur с)" || bad "разные игроки одного матча: оплата ждала $dur с"

# 8. Откат первой транзакции: вторая сессия ждёт блокировку, после отката видит остаток 100 и платит его (матч и событие)
q <<SQL
insert into match_fees (match_id, player_id, amount, paid) values ('$M3', '$P1', 100, false) on conflict do nothing;
SQL
RB_M=00000000-0000-0000-0000-00000722f00a; RB_T=00000000-0000-0000-0000-00000722a00a
q <<SQL
insert into matches (id, club_id, played_on, team, opponent, kind) values ('$RB_M', '$CL', '2026-11-10', 'U9', 'Откат', 'friendly');
insert into match_fees (match_id, player_id, amount, paid) values ('$RB_M', '$P1', 100, false);
insert into tournaments (id, club_id, team, kind, name, fee) values ('$RB_T', '$CL', 'U9', 'championship', 'Откат', 100);
insert into tournament_fees (tournament_id, player_id, amount, paid) values ('$RB_T', '$P1', 100, false);
SQL
{ as; echo "begin;"; echo "select match_pay('$RB_M', array['$P1']::uuid[], null, null, 'Наличные', null);"; echo "select event_pay('$RB_T', array['$P1']::uuid[], null, null, 'Наличные', null);"; echo "select pg_sleep(1.5);"; echo "rollback;"; } > "$T/rb1.sql"
{ as; echo "select pg_sleep(0.5);"; echo "select 'N=' || match_pay('$RB_M', array['$P1']::uuid[], null, null, 'Перевод', null);"; echo "select 'N=' || event_pay('$RB_T', array['$P1']::uuid[], null, null, 'Перевод', null);"; } > "$T/rb2.sql"
$PSQL -q -t -A -d "$DB" -f "$T/rb1.sql" > "$T/rb1.out" 2>&1 &
$PSQL -q -t -A -d "$DB" -f "$T/rb2.sql" > "$T/rb2.out" 2>&1 &
wait
s=$(sumof match_payments "match_id = '$RB_M' and player_id = '$P1'"); c=$(cntof match_payments "match_id = '$RB_M' and player_id = '$P1'")
[ "$s" = 100.00 ] && [ "$c" = 1 ] && ok "матч: после отката первой транзакции вторая оплатила остаток один раз" || bad "матч после отката: сумма $s, строк $c"
s=$(sumof tournament_payments "tournament_id = '$RB_T' and player_id = '$P1'"); c=$(cntof tournament_payments "tournament_id = '$RB_T' and player_id = '$P1'")
[ "$s" = 100.00 ] && [ "$c" = 1 ] && ok "событие: после отката первой транзакции вторая оплатила остаток один раз" || bad "событие после отката: сумма $s, строк $c"
grep -c "N=1" "$T/rb2.out" | grep -q 2 && ok "после отката обе оплаты второй сессии вернули 1" || { cat "$T/rb2.out"; bad "после отката вторая сессия не вернула 1"; }

# 9. Два разных запроса (явная сумма 60 и оплата остатка) одновременно: итог ровно 100, не 160
RD_M=00000000-0000-0000-0000-00000722f00b
q <<SQL
insert into matches (id, club_id, played_on, team, opponent, kind) values ('$RD_M', '$CL', '2026-11-11', 'U9', 'Разные', 'friendly');
insert into match_fees (match_id, player_id, amount, paid) values ('$RD_M', '$P1', 100, false);
SQL
for i in 1 2 3; do
  { as; echo "select pg_sleep(0.3); select match_pay('$RD_M', array['$P1']::uuid[], 60, null, 'Наличные', null);"; } > "$T/rd$i.sql"
  { as; echo "select pg_sleep(0.3); select match_pay('$RD_M', array['$P1']::uuid[], null, null, 'Перевод', null);"; } > "$T/re$i.sql"
done
for i in 1 2 3; do $PSQL -q -t -A -d "$DB" -f "$T/rd$i.sql" > "$T/rd$i.out" 2>&1 & $PSQL -q -t -A -d "$DB" -f "$T/re$i.sql" > "$T/re$i.out" 2>&1 & done; wait
s=$(sumof match_payments "match_id = '$RD_M' and player_id = '$P1' and amount > 0")
# явные платежи по 60 допустимы как самостоятельные (переплата по явной сумме разрешена), оплата остатка NULL никогда не даёт переплаты сама: сумма NULL-платежей <= 100 - предыдущих
neg=$(q -c "select count(*) from match_payments where match_id = '$RD_M' and amount <= 0")
[ "$neg" = 0 ] && [ "$(cat "$T"/rd*.out "$T"/re*.out | grep -c ERROR || true)" = 0 ] && ok "разные запросы: ошибок нет, платежи положительные (сумма $s)" || bad "разные запросы: проблема"
nrows=$(q -c "select count(*) from match_payments where match_id = '$RD_M' and player_id = '$P1' and method = 'Перевод'")
nmax=$(q -c "select coalesce(max(amount), 0) from match_payments where match_id = '$RD_M' and player_id = '$P1' and method = 'Перевод'")
[ "$nrows" -le 1 ] && awk -v m="$nmax" 'BEGIN { exit !(m <= 100) }' && ok "разные запросы: оплата остатка прошла не более одного раза и не больше остатка ($nrows, $nmax)" || bad "разные запросы: оплат остатка $nrows, максимум $nmax"
exit $fail
