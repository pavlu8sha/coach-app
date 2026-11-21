#!/usr/bin/env bash
# Конкурентность player_group_since (0219): обычный перевод игрока в другую группу (UPDATE players.group_id) и перенос начала группы
# задним числом выполняются одновременно. Перенос ждёт замок строки игрока, читает границы уже после коммита перевода и видит новую
# текущую группу, поэтому не пишет границы по устаревшей истории: получает отказ, интервалы истории не пересекаются и не имеют дыр.
# Запуск из scripts/run-db-tests.sh после миграций: DB_NAME и PSQL берутся оттуда.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
CL=00000000-0000-0000-0000-0000ee0000c1
AD=00000000-0000-0000-0000-0000ee0000a1
G1=00000000-0000-0000-0000-0000ee0000e1
G2=00000000-0000-0000-0000-0000ee0000e2
G3=00000000-0000-0000-0000-0000ee0000e3
PL=00000000-0000-0000-0000-0000ee00d001
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность player_group_since');
insert into users (id, telegram_id, display_name, is_admin, club_id) values ('$AD', 990701, 'Админ', true, '$CL');
insert into groups (id, club_id, name) values ('$G1', '$CL', 'Г1'), ('$G2', '$CL', 'Г2'), ('$G3', '$CL', 'Г3');
insert into players (id, club_id, group_id, full_name, status) values ('$PL', '$CL', '$G2', 'Игрок конкурентности', 'active');
delete from player_group_history where player_id = '$PL';
insert into player_group_history (player_id, group_id, valid_from, valid_to) values
  ('$PL', '$G1', date '1970-01-01', tbilisi_day(now()) - 5), ('$PL', '$G2', tbilisi_day(now()) - 5, null);
SQL

# A: обычный перевод в Г3, коммит через 1 с; B: через 0.3 с пытается перенести начало Г2 на 10 дней назад
printf "begin; update players set group_id = '%s' where id = '%s'; select pg_sleep(1); commit;\n" "$G3" "$PL" > "$T/a.sql"
{
  printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$AD"
  printf "select pg_sleep(0.3);\nselect player_group_since('%s', tbilisi_day(now()) - 10, true);\n" "$PL"
} > "$T/b.sql"
$PSQL -q -d "$DB" -f "$T/a.sql" >"$T/a.out" 2>&1 & A=$!
$PSQL -q -d "$DB" -f "$T/b.sql" >"$T/b.out" 2>&1 & B=$!
wait $A || true; wait $B || true

cur=$(q -c "select group_id from player_group_history where player_id = '$PL' and valid_to is null")
[ "$cur" = "$G3" ] && ok "player_group_since: после перевода текущая группа Г3" || bad "player_group_since: текущая группа $cur"
grep -q "date before previous group start" "$T/b.out" && ok "player_group_since: перенос дождался перевода, прочитал новую историю и отклонён" || bad "player_group_since: ожидался отказ по свежей истории: $(cat "$T/b.out")"
gaps=$(q -c "select count(*) from player_group_history a join player_group_history b on b.player_id = a.player_id and b.valid_from > a.valid_from and b.valid_from < coalesce(a.valid_to, 'infinity') where a.player_id = '$PL'")
holes=$(q -c "select count(*) from player_group_history a where a.player_id = '$PL' and a.valid_to is not null and not exists (select 1 from player_group_history b where b.player_id = a.player_id and b.valid_from = a.valid_to)")
[ "$gaps" = 0 ] && ok "player_group_since: интервалы истории не пересекаются" || bad "player_group_since: пересечений: $gaps"
[ "$holes" = 0 ] && ok "player_group_since: в истории нет дыр" || bad "player_group_since: дыр: $holes"
q -c "delete from player_group_history where player_id = '$PL'; delete from players where club_id = '$CL'; delete from groups where club_id = '$CL'; delete from users where id = '$AD'; delete from clubs where id = '$CL';" >/dev/null 2>&1 || true
exit $fail
