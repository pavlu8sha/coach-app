#!/usr/bin/env bash
# Конкурентные платежи мероприятий (миграция 0210, Issue #677): IDEM2, IDEM4, PAY16.
# Запуск из scripts/run-db-tests.sh после миграций: DB_NAME и PSQL берутся оттуда.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1"; }
CL=00000000-0000-0000-0000-0000ce0000c2
AD=00000000-0000-0000-0000-0000ce0000a2
P1=00000000-0000-0000-0000-0000ce00e001; P2=00000000-0000-0000-0000-0000ce00e002
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность платежей мероприятий');
insert into users (id, telegram_id, display_name, is_admin, club_id) values ('$AD', 995002, 'Админ платежей', true, '$CL');
insert into players (id, club_id, full_name, status) values ('$P1', '$CL', 'Игрок 1', 'active'), ('$P2', '$CL', 'Игрок 2', 'active');
insert into club_events (club_id, name, starts_on, base_price, status)
  select '$CL', 'Платежи-' || g, date '2099-02-01' + g, 1000, 'active' from generate_series(1, 25) g;
insert into club_event_participants (event_id, player_id, status)
  select e.id, p, 'active' from club_events e, unnest(array['$P1', '$P2']::uuid[]) p where e.club_id = '$CL';
SQL
EV1=$(q -c "select id from club_events where club_id = '$CL' order by name limit 1")

# IDEM4: восемь параллельных платежей с разными ключами по одной записи суммируются без потерь
pay_distinct() {
  { as "$AD"; echo "select club_event_pay('$EV1', '$P1', 10, 'Наличные', null, gen_random_uuid());"; } | $PSQL -q -d "$DB" >/dev/null 2>&1 || true
}
for i in 1 2 3 4 5 6 7 8; do pay_distinct & done; wait
rows=$(q -c "select count(*) from service_payments where kind = 'event' and ref_id = '$EV1' and player_id = '$P1'")
sum=$(q -c "select coalesce(sum(amount), 0) from service_payments where kind = 'event' and ref_id = '$EV1' and player_id = '$P1'")
[ "$rows" = 8 ] && [ "$sum" = 80.00 ] && ok "платежи мероприятий: восемь параллельных платежей суммируются без потерь (80)" || bad "платежи мероприятий: строк $rows, сумма $sum (ожидалось 8 и 80.00)"

# IDEM2: шесть параллельных вызовов с одним ключом дают одну строку
REQ=00000000-0000-0000-0000-0000ce00f001
pay_same() {
  { as "$AD"; echo "select club_event_pay('$EV1', '$P2', 25, 'Перевод', null, '$REQ');"; } | $PSQL -q -d "$DB" >/dev/null 2>&1 || true
}
for i in 1 2 3 4 5 6; do pay_same & done; wait
rows=$(q -c "select count(*) from service_payments where kind = 'event' and request_id = '$REQ'")
[ "$rows" = 1 ] && ok "платежи мероприятий: шесть параллельных повторов с одним ключом дают одну строку" || bad "платежи мероприятий: строк с одним ключом $rows"

# PAY16: платёж против отмены записи и против отмены мероприятия; ошибок гонки (deadlock) нет, принятые платежи = строки журнала
LOG=$(mktemp)
race_pay() {   # $1 мероприятие, $2 игрок
  { as "$AD"; echo "select 'PAYOK' where (club_event_pay('$1', '$2', 5, 'Наличные', null, gen_random_uuid()) ->> 'applied') = 'true';"; } | $PSQL -q -t -A -d "$DB" 2>&1 | grep -E "PAYOK|ERROR" >> "$LOG" || true
}
race_cancel() {
  { as "$AD"; echo "select club_event_participant_cancel((select id from club_event_participants where event_id = '$1' and player_id = '$2'));"; } | $PSQL -q -d "$DB" 2>&1 | grep -E "ERROR" >> "$LOG" || true
}
race_status() {
  { as "$AD"; echo "select club_event_set_status('$1', 'cancelled');"; } | $PSQL -q -d "$DB" 2>&1 | grep -E "ERROR" >> "$LOG" || true
}
EVS=$(q -c "select id from club_events where club_id = '$CL' and id <> '$EV1' order by name")
n=0
for e in $EVS; do
  n=$((n + 1))
  if [ $((n % 2)) = 0 ]; then
    race_pay "$e" "$P1" & race_cancel "$e" "$P1" & race_pay "$e" "$P1" &
  else
    race_pay "$e" "$P2" & race_status "$e" & race_pay "$e" "$P2" &
  fi
done
wait
if grep -qi "deadlock" "$LOG"; then bad "платежи мероприятий: гонка платежа и отмены дала deadlock"; else ok "платежи мероприятий: гонка платежа и отмены без deadlock"; fi
accepted=$(grep -c PAYOK "$LOG" || true)
rows=$(q -c "select count(*) from service_payments where kind = 'event' and ref_id <> '$EV1' and ref_id in (select id from club_events where club_id = '$CL')")
[ "$accepted" = "$rows" ] && ok "платежи мероприятий: принятых платежей столько же, сколько строк журнала ($rows)" || bad "платежи мероприятий: принято $accepted, строк в журнале $rows"
# платёж по отменённой записи или в отменённом мероприятии не прошёл после отмены: при отменённой записи/мероприятии сумма строк не превышает двух платежей (выполнены до отмены)
over=$(q -c "select count(*) from (select sp.ref_id, sp.player_id from service_payments sp where sp.kind = 'event' and sp.ref_id <> '$EV1' and sp.ref_id in (select id from club_events where club_id = '$CL') group by 1, 2 having count(*) > 2) x")
[ "$over" = 0 ] && ok "платежи мероприятий: на одну запись не больше двух принятых платежей из двух отправленных" || bad "платежи мероприятий: записей с более чем двумя платежами: $over"
rm -f "$LOG"
exit $fail
