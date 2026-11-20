#!/usr/bin/env bash
# Конкурентность миграции 0213: дозаполнение визитов (player_set_pay_mode -> own_visits_backfill) и триггер attendance_own_visit_sync
# сериализуются на строке игрока. Без общей блокировки триггер читал старый pay_mode, а дозаполнение не видело незакоммиченную отметку:
# визит терялся (отметка «Был») или оставался лишним (отметка «Был» -> «Не был»). Транзакции перекрываются намеренно (pg_sleep внутри открытой транзакции).
# Запуск из scripts/run-db-tests.sh после миграций и pgTAP-тестов: DB_NAME и PSQL берутся оттуда.
set -uo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1"; }
CL=00000000-0000-0000-0000-0000ee0000c1; AD=00000000-0000-0000-0000-0000ee0000a1; GR=00000000-0000-0000-0000-0000ee0000e1
SE=00000000-0000-0000-0000-0000ee0005a1
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pl() { printf '00000000-0000-0000-0000-0000ee00d%03d' "$1"; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность визитов');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990701, 'Админ', true);
insert into groups (id, club_id, name, location) values ('$GR', '$CL', 'U9-C', 'Чиовани');
insert into sessions (id, group_id, starts_at, kind, source_key, class) values ('$SE', '$GR', (current_date - 3) + time '15:00', 'training', 'ATT|conc-visit', 'regular');
insert into players (id, club_id, group_id, full_name, status) select ('00000000-0000-0000-0000-0000ee00d' || lpad(g::text, 3, '0'))::uuid, '$CL', '$GR', 'Игрок ' || g, 'active' from generate_series(1, 7) g;
SQL
FROM=$(q -c "select current_date - 10")
visits() { q -c "select count(*) from own_visits where player_id = '$1' and session_id = '$SE'"; }

# Дозаполнение держит строку игрока 2 с (pg_sleep), отметка приходит во время этого окна или до него.
# Каждый оператор на своей строке: pg_sleep виден в pg_stat_activity отдельным запросом, и вторая транзакция стартует, только когда первая держит блокировки.
setmode() { { as "$AD"; printf "begin;\nselect player_set_pay_mode('%s', 'per_visit', '%s');\nselect pg_sleep(2);\ncommit;\n" "$1" "$FROM"; } | $PSQL -q -d "$DB" >"$T/$2.out" 2>&1; }
mark() { printf "begin;\n%s\nselect pg_sleep(%s);\ncommit;\n" "$2" "${3:-0.1}" | $PSQL -q -d "$DB" >"$T/$1.out" 2>&1; }
# ждать, пока первая транзакция дошла до паузы (то есть уже держит свои блокировки)
sleeping() { for _ in $(seq 1 100); do [ "$(q -c "select count(*) from pg_stat_activity where datname = current_database() and state = 'active' and query like 'select pg_sleep(2)%'")" != 0 ] && return 0; sleep 0.1; done; return 1; }

# 1. Отметка «Был» приходит во время смены режима: визит должен появиться
P=$(pl 1)
setmode "$P" s1a & A=$!; sleeping
mark s1b "insert into attendance (session_id, player_id, status) values ('$SE', '$P', 'present');" & B=$!
wait $A; wait $B
[ "$(visits "$P")" = 1 ] && ok "отметка «Был» во время смены режима: визит создан" || { bad "отметка «Был» во время смены режима: визитов $(visits "$P")"; cat "$T/s1a.out" "$T/s1b.out"; }

# 2. Отметка «Был» открыта (не закоммитена), смена режима приходит после: дозаполнение должно дождаться и увидеть отметку
P=$(pl 2)
mark s2b "insert into attendance (session_id, player_id, status) values ('$SE', '$P', 'present');" 2 & B=$!; sleeping
setmode "$P" s2a & A=$!
wait $A; wait $B
[ "$(visits "$P")" = 1 ] && ok "смена режима после открытой отметки «Был»: ровно один визит" || { bad "смена режима после открытой отметки «Был»: визитов $(visits "$P")"; cat "$T/s2a.out" "$T/s2b.out"; }

# 3. «Был» уже стоит, смена режима создаёт визит, одновременно отметку снимают («Не был»): лишнего визита остаться не должно
P=$(pl 3)
q -c "insert into attendance (session_id, player_id, status) values ('$SE', '$P', 'present')"
setmode "$P" s3a & A=$!; sleeping
mark s3b "update attendance set status = 'absent' where session_id = '$SE' and player_id = '$P';" & B=$!
wait $A; wait $B
[ "$(visits "$P")" = 0 ] && ok "снятие отметки во время смены режима: лишнего визита нет" || { bad "снятие отметки во время смены режима: визитов $(visits "$P")"; cat "$T/s3a.out" "$T/s3b.out"; }

# 4. Отметку снимают (транзакция открыта), смена режима приходит после: визит за «Не был» не создаётся
P=$(pl 4)
q -c "insert into attendance (session_id, player_id, status) values ('$SE', '$P', 'present')"
mark s4b "update attendance set status = 'absent' where session_id = '$SE' and player_id = '$P';" 2 & B=$!; sleeping
setmode "$P" s4a & A=$!
wait $A; wait $B
[ "$(visits "$P")" = 0 ] && ok "смена режима после открытого снятия отметки: визита нет" || { bad "смена режима после открытого снятия отметки: визитов $(visits "$P")"; cat "$T/s4a.out" "$T/s4b.out"; }

# 5. Отметка «Не был» меняется на «Был» (UPDATE не берёт блокировку игрока через внешний ключ) во время смены режима: визит должен появиться
P=$(pl 5)
q -c "insert into attendance (session_id, player_id, status) values ('$SE', '$P', 'absent')"
setmode "$P" s5a & A=$!; sleeping
mark s5b "update attendance set status = 'present' where session_id = '$SE' and player_id = '$P';" & B=$!
wait $A; wait $B
[ "$(visits "$P")" = 1 ] && ok "исправление «Не был» на «Был» во время смены режима: визит создан" || { bad "исправление «Не был» на «Был» во время смены режима: визитов $(visits "$P")"; cat "$T/s5a.out" "$T/s5b.out"; }

# 6. Исправление «Не был» на «Был» открыто, смена режима приходит после: ровно один визит
P=$(pl 6)
q -c "insert into attendance (session_id, player_id, status) values ('$SE', '$P', 'absent')"
mark s6b "update attendance set status = 'present' where session_id = '$SE' and player_id = '$P';" 2 & B=$!; sleeping
setmode "$P" s6a & A=$!
wait $A; wait $B
[ "$(visits "$P")" = 1 ] && ok "смена режима после открытого исправления на «Был»: ровно один визит" || { bad "смена режима после открытого исправления на «Был»: визитов $(visits "$P")"; cat "$T/s6a.out" "$T/s6b.out"; }

# 7. Строку отметки «Был» удаляют во время смены режима: лишнего визита остаться не должно
P=$(pl 7)
q -c "insert into attendance (session_id, player_id, status) values ('$SE', '$P', 'present')"
setmode "$P" s7a & A=$!; sleeping
mark s7b "delete from attendance where session_id = '$SE' and player_id = '$P';" & B=$!
wait $A; wait $B
[ "$(visits "$P")" = 0 ] && ok "удаление отметки во время смены режима: лишнего визита нет" || { bad "удаление отметки во время смены режима: визитов $(visits "$P")"; cat "$T/s7a.out" "$T/s7b.out"; }

dl=$(cat "$T"/*.out | grep -ci 'deadlock')
[ "$dl" = 0 ] && ok "взаимных блокировок нет" || { bad "взаимные блокировки: $dl"; cat "$T"/*.out; }
[ "$fail" = 0 ]
