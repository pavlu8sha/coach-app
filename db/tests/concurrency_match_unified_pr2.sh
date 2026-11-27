#!/usr/bin/env bash
# Конкурентность save_match против отмены/переноса (миграция 0227): строка матча блокируется до проверки статуса,
# результат либо записан до смены статуса, либо отклонён после неё, но никогда не попадает в отменённый матч.
# Запуск из scripts/run-db-tests.sh: DB_NAME и PSQL берутся оттуда. БД удаляется скриптом.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1"; }
CL=00000000-0000-0000-0000-00000000c1f1; CO=00000000-0000-0000-0000-0000000001f1; AD=00000000-0000-0000-0000-0000000001f9
PL=00000000-0000-0000-0000-00000001f001; GR=00000000-0000-0000-0000-0000000001f4
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность 0227');
insert into users (id, telegram_id, display_name, is_admin, club_id) values ('$CO', 991001, 'Тренер', false, '$CL'), ('$AD', 991004, 'Админ', true, '$CL');
insert into groups (id, club_id, name) values ('$GR', '$CL', 'UD');
insert into coach_groups (user_id, group_id) values ('$CO', '$GR');
insert into players (id, club_id, group_id, full_name) values ('$PL', '$CL', '$GR', 'Игрок Блокировки');
SQL
trap '' EXIT

new_match() {
  local M
  M=$({ as "$CO"; echo "select match_rsvp_create_draft('$CL', 'game', 'UD', 'Соперник', now() + interval '3 days', null, null, null);"; } | $PSQL -q -t -A -d "$DB" | tail -1)
  { as "$CO"; echo "select match_rsvp_invite('$M', array['$PL']::uuid[]); select match_rsvp_publish('$M');"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null
  echo "$M"
}
SAVE="select save_match('%s', '$GR', current_date, 'Новый соперник', null, null, '[{\"player_id\":\"$PL\",\"played\":true}]'::jsonb);"

# 1. Отмена держит блокировку: сохранение ждёт, потом отклоняется, отметки и соперник не записаны
M=$(new_match)
{ as "$AD"; echo "begin; select match_rsvp_cancel('$M', 'тест'); select pg_sleep(2); commit;"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null & R=$!
sleep 0.7
t0=$(date +%s.%N)
out=$({ as "$CO"; printf "$SAVE\n" "$M"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" 2>&1) && rc=0 || rc=$?
t1=$(date +%s.%N); wait $R
[ "$rc" != 0 ] && echo "$out" | grep -q 'match is cancelled' && ok "сохранение результата после отмены отклонено (match is cancelled)" || bad "сохранение после отмены отклонено ($rc: $out)"
[ "$(echo "$t1 - $t0 > 0.8" | bc -l)" = 1 ] && ok "сохранение дождалось отмены (блокировка строки матча)" || bad "сохранение дождалось отмены"
st=$(q -c "select (select lifecycle_status from matches where id = '$M') || ':' || (select count(*) from match_players where match_id = '$M' and played) || ':' || (select coalesce(opponent, '') from matches where id = '$M')")
[ "$st" = "cancelled:0:Соперник" ] && ok "в отменённый матч ничего не записано ($st)" || bad "итог отмены и сохранения ($st)"

# 2. Сохранение держит блокировку: отмена ждёт и применяется после, результат записан до отмены
M2=$(new_match)
{ as "$CO"; echo "begin;"; printf "$SAVE\n" "$M2"; echo "select pg_sleep(2); commit;"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null & R=$!
sleep 0.7
t0=$(date +%s.%N)
{ as "$AD"; echo "select match_rsvp_cancel('$M2', 'тест');"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null
t1=$(date +%s.%N); wait $R
[ "$(echo "$t1 - $t0 > 0.8" | bc -l)" = 1 ] && ok "отмена дождалась сохранения результата" || bad "отмена дождалась сохранения"
st=$(q -c "select (select lifecycle_status from matches where id = '$M2') || ':' || (select count(*) from match_players where match_id = '$M2' and played) || ':' || (select opponent from matches where id = '$M2')")
[ "$st" = "cancelled:1:Новый соперник" ] && ok "итог: результат записан до отмены, затем матч отменён ($st)" || bad "итог сохранения и отмены ($st)"

# 3. Перенос держит блокировку, сохранение ждёт и проходит (матч остаётся опубликованным)
M3=$(new_match)
{ as "$AD"; echo "begin; select match_rsvp_reschedule('$M3', now() + interval '9 days'); select pg_sleep(2); commit;"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null & R=$!
sleep 0.7
t0=$(date +%s.%N)
{ as "$CO"; printf "$SAVE\n" "$M3"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null
t1=$(date +%s.%N); wait $R
[ "$(echo "$t1 - $t0 > 0.8" | bc -l)" = 1 ] && ok "сохранение дождалось переноса" || bad "сохранение дождалось переноса"
st=$(q -c "select (select lifecycle_status from matches where id = '$M3') || ':' || (select count(*) from match_players where match_id = '$M3' and played)")
[ "$st" = "published:1" ] && ok "итог: перенос применён, результат записан ($st)" || bad "итог переноса и сохранения ($st)"

[ "$fail" = 0 ] && echo "Конкурентные проверки save_match (0227) прошли" || { echo "ЕСТЬ ПАДЕНИЯ (конкурентность save_match 0227)"; exit 1; }
