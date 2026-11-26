#!/usr/bin/env bash
# Конкурентность сохранения матча с оценками (0223): два сохранения одного матча идут одновременно (оценки разные).
# Начисление пересчитывается отложенными триггерами при коммите под замком points_ledger_apply: на игрока остаётся одна действующая строка
# с оценкой того сохранения, которое завершилось последним, без дублей и без ошибок уникального индекса.
# Запуск из scripts/run-db-tests.sh после миграций: DB_NAME и PSQL берутся оттуда.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
CL=00000000-0000-0000-0000-0000f7b000c1
AD=00000000-0000-0000-0000-0000f7b000a1
G1=00000000-0000-0000-0000-0000f7b000e1
P1=00000000-0000-0000-0000-0000f7b0d001
P2=00000000-0000-0000-0000-0000f7b0d002
M=00000000-0000-0000-0000-0000f7b0aa01
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность оценок матча');
insert into users (id, telegram_id, display_name, is_admin, club_id) values ('$AD', 9990223, 'Админ', true, '$CL');
insert into groups (id, club_id, name) values ('$G1', '$CL', 'Г1');
insert into players (id, club_id, group_id, full_name, status) values ('$P1', '$CL', '$G1', 'Игрок 1', 'active'), ('$P2', '$CL', '$G1', 'Игрок 2', 'active');
insert into rules (club_id, code, points, explanation, active_from) values ('$CL', 'match_played', 1, 'x', '2020-01-01'), ('$CL', 'match_win', 2, 'x', '2020-01-01'), ('$CL', 'match_best', 3, 'x', '2020-01-01'), ('$CL', 'match_goal', 1, 'x', '2020-01-01');
insert into points_rule_versions (club_id, effective_from, params) values ('$CL', date '2024-01-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('model', 'rating', 'best', 1, 'cap', 6, 'technical', 0, 'played', 0, 'draw', 0, 'win', 0, 'goal', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()), 'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)));
insert into matches (id, club_id, played_on, team, opponent) values ('$M', '$CL', date '2025-03-10', 'U10', 'Соперник');
SQL

roster() { printf '[{"player_id":"%s","played":true,"goals":0,"best":true,"performance_rating":%s},{"player_id":"%s","played":true,"goals":0,"best":false,"performance_rating":%s}]' "$P1" "$1" "$P2" "$2"; }
auth() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$AD"; }
# A: оценки 3 и 2, коммит через 1 с; B: через 0.3 с сохраняет оценки 5 и 4 (ждёт замок строк состава)
{ auth; printf "begin;\nselect save_match('%s', '%s', date '2025-03-10', 'Соперник', 1, 0, '%s');\nselect pg_sleep(1);\ncommit;\n" "$M" "$G1" "$(roster 3 2)"; } > "$T/a.sql"
{ auth; printf "select pg_sleep(0.3);\nbegin;\nselect save_match('%s', '%s', date '2025-03-10', 'Соперник', 1, 0, '%s');\ncommit;\n" "$M" "$G1" "$(roster 5 4)"; } > "$T/b.sql"
$PSQL -q -d "$DB" -f "$T/a.sql" >"$T/a.out" 2>&1 & A=$!
$PSQL -q -d "$DB" -f "$T/b.sql" >"$T/b.out" 2>&1 & B=$!
wait $A || true; wait $B || true

grep -qi "error" "$T/a.out" "$T/b.out" && bad "сохранения завершились ошибкой: $(cat "$T/a.out" "$T/b.out")" || ok "оба сохранения завершились без ошибок"
n=$(q -c "select count(*) from points_ledger where source_id = '$M' and status = 'active'")
[ "$n" = 2 ] && ok "действующих строк по одной на игрока (2)" || bad "действующих строк: $n"
d=$(q -c "select count(*) from (select player_id from points_ledger where source_id = '$M' and status = 'active' group by player_id having count(*) > 1) x")
[ "$d" = 0 ] && ok "дублей действующих строк нет" || bad "дублей: $d"
pts=$(q -c "select string_agg(points::text, ',' order by player_id) from points_ledger where source_id = '$M' and status = 'active'")
rat=$(q -c "select string_agg(performance_rating::text, ',' order by player_id) from match_players where match_id = '$M'")
[ "$pts" = "6,4" ] && [ "$rat" = "5,4" ] && ok "итог соответствует последнему сохранению (оценки 5 и 4: баллы 6 и 4)" || bad "итог: баллы $pts, оценки $rat"
q -c "delete from match_revisions where match_id = '$M'; delete from matches where id = '$M';" >/dev/null 2>&1 || true
q -c "delete from points_ledger_audit where source_id = '$M'" >/dev/null 2>&1 || true
exit $fail
