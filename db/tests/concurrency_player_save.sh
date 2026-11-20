#!/usr/bin/env bash
# Конкурентность player_save (0209, #654, И2.4а п. 3): два администратора одновременно назначают один номер
# двум игрокам одной команды. Одно сохранение проходит, второе отклоняется уникальным индексом
# player_jersey_history_open_number, и у проигравшего не меняется ни игрок, ни профиль.
# Запуск из scripts/run-db-tests.sh после миграций: DB_NAME и PSQL берутся оттуда.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1"; }
CL=00000000-0000-0000-0000-0000dd0000c1
AD=00000000-0000-0000-0000-0000dd0000a1
GR=00000000-0000-0000-0000-0000dd0000e1
N=4
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность player_save');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990601, 'Админ', true);
insert into groups (id, club_id, name) values ('$GR', '$CL', 'U11-A');
insert into players (id, club_id, group_id, full_name, status)
  select ('00000000-0000-0000-0000-0000dd00d' || lpad(g::text, 3, '0'))::uuid, '$CL', '$GR', 'Игрок ' || g, 'active' from generate_series(1, $((N * 2))) g;
SQL
pid() { printf '00000000-0000-0000-0000-0000dd00d%03d' "$1"; }
: > "$T/a.sql"; : > "$T/b.sql"; as "$AD" >> "$T/a.sql"; as "$AD" >> "$T/b.sql"
for i in $(seq 1 $N); do
  a=$(pid $((i * 2 - 1))); b=$(pid $((i * 2)))
  echo "begin; select player_save('$a', null, '{\"full_name\":\"Победитель $i\",\"group_id\":\"$GR\",\"status\":\"active\"}'::jsonb, '{\"first_name\":\"П\",\"last_name\":\"$i\",\"jersey_number\":$i}'::jsonb); select pg_sleep(0.5); commit;" >> "$T/a.sql"
  echo "select pg_sleep(0.15); select player_save('$b', null, '{\"full_name\":\"Проигравший $i\",\"group_id\":\"$GR\",\"status\":\"inactive\"}'::jsonb, '{\"first_name\":\"Х\",\"last_name\":\"$i\",\"jersey_number\":$i}'::jsonb);" >> "$T/b.sql"
done
$PSQL -q -d "$DB" -f "$T/a.sql" >"$T/a.out" 2>&1 & A=$!
$PSQL -q -d "$DB" -f "$T/b.sql" >"$T/b.out" 2>&1 & B=$!
wait $A || true; wait $B || true
dup=$(q -c "select count(*) from (select jersey_number from player_profiles p join players pl on pl.id = p.player_id where pl.club_id = '$CL' and jersey_number is not null group by jersey_number having count(*) > 1) x")
win=$(q -c "select count(*) from player_profiles p join players pl on pl.id = p.player_id where pl.club_id = '$CL' and p.jersey_number is not null")
lost=$(q -c "select count(*) from players where club_id = '$CL' and (full_name like 'Проигравший%' or status = 'inactive')")
lostprof=$(q -c "select count(*) from player_profiles p join players pl on pl.id = p.player_id where pl.club_id = '$CL' and p.first_name = 'Х'")
rej=$(grep -c "player_jersey_history_open_number\|duplicate key" "$T/b.out" || true)
[ "$dup" = 0 ] && ok "player_save: один номер не достался двум игрокам" || bad "player_save: дублей номера: $dup"
[ "$win" = "$N" ] && ok "player_save: ровно по одному назначению на номер ($win из $N)" || bad "player_save: назначений $win из $N"
[ "$lost" = 0 ] && ok "player_save: у проигравшей операции игрок не изменён" || bad "player_save: изменённых игроков у проигравших: $lost"
[ "$lostprof" = 0 ] && ok "player_save: у проигравшей операции профиль не изменён" || bad "player_save: изменённых профилей у проигравших: $lostprof"
[ "$rej" -ge 1 ] && ok "player_save: проигравшие отклонены уникальным индексом ($rej)" || bad "player_save: отказов по индексу не видно"
q -c "delete from players where club_id = '$CL'; delete from groups where club_id = '$CL'; delete from users where id = '$AD'; delete from clubs where id = '$CL';" >/dev/null 2>&1 || true
exit $fail
