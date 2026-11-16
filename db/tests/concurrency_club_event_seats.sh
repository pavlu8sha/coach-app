#!/usr/bin/env bash
# Конкурентная запись на мероприятие (миграция 0204, Issue #677): параллельные добавления и восстановления за последнее место не превышают лимит.
# Запуск из scripts/run-db-tests.sh после миграций: DB_NAME и PSQL берутся оттуда.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1"; }
CL=00000000-0000-0000-0000-0000ce0000c1
AD=00000000-0000-0000-0000-0000ce0000a1
K1=00000000-0000-0000-0000-0000ce00d001; K2=00000000-0000-0000-0000-0000ce00d002; K3=00000000-0000-0000-0000-0000ce00d003; K4=00000000-0000-0000-0000-0000ce00d004
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность мероприятий');
insert into users (id, telegram_id, display_name, is_admin, club_id) values ('$AD', 995001, 'Админ', true, '$CL');
insert into players (id, club_id, full_name, status) values ('$K1', '$CL', 'Игрок 1', 'active'), ('$K2', '$CL', 'Игрок 2', 'active'), ('$K3', '$CL', 'Игрок 3', 'active'), ('$K4', '$CL', 'Игрок 4', 'active');
insert into club_events (club_id, name, starts_on, base_price, capacity, status)
  select '$CL', 'Мероприятие-' || g, date '2099-01-01' + g, 10, 1, 'active' from generate_series(1, 30) g;
SQL

EVS=$(q -c "select id from club_events where club_id = '$CL' order by name")
worker() {  # пробует записать игрока на каждое мероприятие; отказы «event full» ожидаемы, поэтому без ON_ERROR_STOP
  local kid=$1
  { as "$AD"; for e in $EVS; do echo "select club_event_participant_add('$e', '$kid');"; done; } | $PSQL -q -d "$DB" >/dev/null 2>&1 || true
}
worker "$K1" & A=$!; worker "$K2" & B=$!; worker "$K3" & C=$!; worker "$K4" & D=$!
wait $A; wait $B; wait $C; wait $D
over=$(q -c "select count(*) from (select event_id from club_event_participants p join club_events e on e.id = p.event_id where e.club_id = '$CL' and p.status = 'active' group by event_id having count(*) > 1) x")
full=$(q -c "select count(*) from (select event_id from club_event_participants p join club_events e on e.id = p.event_id where e.club_id = '$CL' and p.status = 'active' group by event_id having count(*) = 1) x")
[ "$over" = 0 ] && ok "мероприятия: ни одно не переполнено при одновременной записи четырёх сессий" || bad "мероприятия: переполнено: $over"
[ "$full" = 30 ] && ok "мероприятия: на каждом занято единственное место" || bad "мероприятия: занятых мест: $full из 30"

# восстановление и добавление за последнее место: у каждого мероприятия отменена запись K1, место свободно; параллельно восстанавливаем K1 и добавляем K2/K3
q <<SQL
update club_event_participants set status = 'cancelled' where event_id in (select id from club_events where club_id = '$CL');
SQL
restorer() {
  { as "$AD"; for e in $EVS; do echo "select club_event_participant_restore((select id from club_event_participants where event_id = '$e' and status = 'cancelled' order by created_at, id limit 1));"; done; } | $PSQL -q -d "$DB" >/dev/null 2>&1 || true
}
worker "$K1" & A=$!; restorer & B=$!; restorer & C=$!
wait $A; wait $B; wait $C
over=$(q -c "select count(*) from (select event_id from club_event_participants p join club_events e on e.id = p.event_id where e.club_id = '$CL' and p.status = 'active' group by event_id having count(*) > 1) x")
[ "$over" = 0 ] && ok "мероприятия: восстановление и добавление за последнее место не превышают лимит" || bad "мероприятия: после восстановления переполнено: $over"
dups=$(q -c "select count(*) from (select event_id, player_id from club_event_participants group by 1, 2 having count(*) > 1) x")
[ "$dups" = 0 ] && ok "мероприятия: дублей записей нет" || bad "мероприятия: дублей: $dups"
exit $fail
