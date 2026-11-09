#!/usr/bin/env bash
# Конкурентная запись на сбор (миграция 0160): родители и администратор одновременно занимают последнее место, лимит не превышается.
# Запуск из scripts/run-db-tests.sh после миграций: DB_NAME и PSQL берутся оттуда.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1"; }
CL=00000000-0000-0000-0000-0000ca0000c1
AD=00000000-0000-0000-0000-0000ca0000a1; P1=00000000-0000-0000-0000-0000ca0000b1; P2=00000000-0000-0000-0000-0000ca0000b2
K1=00000000-0000-0000-0000-0000ca00d001; K2=00000000-0000-0000-0000-0000ca00d002; K3=00000000-0000-0000-0000-0000ca00d003
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность сборов');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990301, 'Админ', true), ('$P1', 990302, 'Родитель 1', false), ('$P2', 990303, 'Родитель 2', false);
insert into players (id, club_id, full_name, status) values ('$K1', '$CL', 'Ребёнок 1', 'active'), ('$K2', '$CL', 'Ребёнок 2', 'active'), ('$K3', '$CL', 'Ребёнок 3', 'active');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('$K1', '$P1', 't', now()), ('$K2', '$P2', 't', now());
insert into camps (club_id, name, starts_on, ends_on, capacity)
  select '$CL', 'Сбор-' || g, date '2099-01-01' + g, date '2099-02-01' + g, 1 from generate_series(1, 30) g;
insert into camp_tariffs (camp_id, name, price) select id, 'Тариф', 100 from camps where club_id = '$CL';
SQL

CAMPS=$(q -c "select id from camps where club_id = '$CL' order by name")
parent() {  # родитель пробует записать ребёнка на каждый сбор; отказы «camp full» ожидаемы, поэтому без ON_ERROR_STOP
  local who=$1 kid=$2
  { as "$who"; for c in $CAMPS; do echo "select camp_parent_register('$c', '$kid', (select id from camp_tariffs where camp_id = '$c'), null);"; done; } | $PSQL -q -d "$DB" >/dev/null 2>&1 || true
}
admin() {  # администратор пробует записать игрока и гостя на тот же сбор
  { as "$AD"; for c in $CAMPS; do
      echo "select camp_register('$c', '$K3', (select id from camp_tariffs where camp_id = '$c'), null, null, null);"
      echo "select camp_register_guest('$c', 'Гость', null, (select id from camp_tariffs where camp_id = '$c'), null, null, null);"
    done; } | $PSQL -q -d "$DB" >/dev/null 2>&1 || true
}
parent "$P1" "$K1" & A=$!; parent "$P2" "$K2" & B=$!; admin & C=$!
wait $A; wait $B; wait $C
over=$(q -c "select count(*) from (select camp_id from camp_participants p join camps c on c.id = p.camp_id where c.club_id = '$CL' and p.status = 'registered' group by camp_id having count(*) > 1) x")
full=$(q -c "select count(*) from (select camp_id from camp_participants p join camps c on c.id = p.camp_id where c.club_id = '$CL' and p.status = 'registered' group by camp_id having count(*) = 1) x")
[ "$over" = 0 ] && ok "сборы: ни один сбор не переполнен при одновременной записи родителей и администратора" || bad "сборы: переполнено сборов: $over"
[ "$full" = 30 ] && ok "сборы: на каждом сборе занято единственное место" || bad "сборы: занятых мест: $full из 30"

[ "$fail" = 0 ] || exit 1
echo "Конкурентные проверки сборов прошли"
