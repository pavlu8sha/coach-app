#!/usr/bin/env bash
# Конкурентная запись на индивидуальное занятие (миграция 0141): два родителя одновременно занимают последнее место, переполнения нет.
# Запуск из scripts/run-db-tests.sh после миграций: DB_NAME и PSQL берутся оттуда.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1"; }
CL=00000000-0000-0000-0000-00000000c0e1
P1=00000000-0000-0000-0000-0000000000e2; P2=00000000-0000-0000-0000-0000000000e3
K1=00000000-0000-0000-0000-00000000e001; K2=00000000-0000-0000-0000-00000000e002
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность записи');
insert into users (id, telegram_id, display_name, is_admin) values ('$P1', 990101, 'Родитель 1', false), ('$P2', 990102, 'Родитель 2', false);
insert into players (id, club_id, full_name, status) values ('$K1', '$CL', 'Ребёнок 1', 'active'), ('$K2', '$CL', 'Ребёнок 2', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('$K1', '$P1', 't', now()), ('$K2', '$P2', 't', now());
insert into club_settings (club_id, key, value, scope) values ('$CL', 'ind.capIndividual', '1', '');
insert into individual_sessions (club_id, external_id, starts_at, goalkeepers)
  select '$CL', 'CONC-' || g, (now() at time zone 'Asia/Tbilisi') + interval '3 days' + g * interval '1 minute', false from generate_series(1, 30) g;
SQL

SESSIONS=$(q -c "select id from individual_sessions where club_id = '$CL' order by external_id")
signup() {  # родитель пробует занять место на каждом из 30 занятий; ошибки «мест нет» ожидаемы, поэтому без ON_ERROR_STOP
  local who=$1 kid=$2
  { as "$who"; for s in $SESSIONS; do echo "select booking_signup('individual', '$s', '$kid');"; done; } | $PSQL -q -d "$DB" >/dev/null 2>&1 || true
}
signup "$P1" "$K1" & A=$!; signup "$P2" "$K2" & B=$!
wait $A; wait $B
over=$(q -c "select count(*) from (select session_id from individual_bookings b join individual_sessions s on s.id = b.session_id where s.club_id = '$CL' group by session_id having count(*) > 1) x")
full=$(q -c "select count(*) from (select session_id from individual_bookings b join individual_sessions s on s.id = b.session_id where s.club_id = '$CL' group by session_id having count(*) = 1) x")
[ "$over" = 0 ] && ok "ни одно занятие не переполнено при одновременной записи" || bad "переполнено занятий: $over"
[ "$full" = 30 ] && ok "на каждом занятии занято единственное место" || bad "занятых мест: $full из 30"
# Очередь (0149): место освободилось, оба родителя из очереди одновременно жмут «занять» — место получает один, переполнения нет.
P3=00000000-0000-0000-0000-0000000000e4; K3=00000000-0000-0000-0000-00000000e003
q <<SQL
insert into users (id, telegram_id, display_name, is_admin) values ('$P3', 990103, 'Родитель 3', false);
insert into players (id, club_id, full_name, status) values ('$K3', '$CL', 'Ребёнок 3', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('$K3', '$P3', 't', now());
insert into individual_sessions (club_id, external_id, starts_at, goalkeepers)
  select '$CL', 'WQ-' || g, (now() at time zone 'Asia/Tbilisi') + interval '5 days' + g * interval '1 minute', false from generate_series(1, 30) g;
SQL
WSESSIONS=$(q -c "select id from individual_sessions where club_id = '$CL' and external_id like 'WQ-%' order by external_id")
{ as "$P3"; for s in $WSESSIONS; do echo "select booking_signup('individual', '$s', '$K3');"; done; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null
for s in $WSESSIONS; do
  q -c "insert into booking_waitlist (club_id, kind, session_id, player_id, user_id) values ('$CL', 'individual', '$s', '$K1', '$P1'), ('$CL', 'individual', '$s', '$K2', '$P2')"
done
q -c "delete from individual_bookings where player_id = '$K3' and session_id in (select id from individual_sessions where club_id = '$CL' and external_id like 'WQ-%')"
claim() {
  local who=$1 kid=$2
  { as "$who"; for s in $WSESSIONS; do echo "select waitlist_claim('individual', '$s', '$kid');"; done; } | $PSQL -q -d "$DB" >/dev/null 2>&1 || true
}
claim "$P1" "$K1" & A=$!; claim "$P2" "$K2" & B=$!
wait $A; wait $B
over=$(q -c "select count(*) from (select session_id from individual_bookings b join individual_sessions s on s.id = b.session_id where s.club_id = '$CL' and s.external_id like 'WQ-%' group by session_id having count(*) > 1) x")
full=$(q -c "select count(*) from (select session_id from individual_bookings b join individual_sessions s on s.id = b.session_id where s.club_id = '$CL' and s.external_id like 'WQ-%' group by session_id having count(*) = 1) x")
[ "$over" = 0 ] && ok "очередь: ни одно занятие не переполнено при одновременном подтверждении" || bad "очередь: переполнено занятий: $over"
[ "$full" = 30 ] && ok "очередь: на каждом занятии место получил один ребёнок" || bad "очередь: занятых мест: $full из 30"

[ "$fail" = 0 ] || exit 1
echo "Конкурентные проверки записи прошли"
