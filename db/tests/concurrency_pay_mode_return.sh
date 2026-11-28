#!/usr/bin/env bash
# Конкурентность миграции 0229: смена режима оплаты с периодом («за визит» <-> абонемент с pay_mode_until) и отметка посещения (триггер attendance_own_visit_sync).
# player_set_pay_mode берёт строку игрока for update, триггер читает её for share: результат должен совпасть с последовательным выполнением в порядке получения блокировки.
# Транзакции перекрываются намеренно (pg_sleep внутри открытой транзакции). Запуск из scripts/run-db-tests.sh: DB_NAME и PSQL берутся оттуда.
set -uo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1"; }
CL=00000000-0000-0000-0000-0000bf1000c1; AD=00000000-0000-0000-0000-0000bf1000a1; GR=00000000-0000-0000-0000-0000bf1000e1
SE=00000000-0000-0000-0000-0000bf1005a1
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pl() { printf '00000000-0000-0000-0000-0000bf10d%03d' "$1"; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность возврата');
insert into users (id, telegram_id, display_name, is_admin, club_id) values ('$AD', 991801, 'Админ', true, '$CL');
insert into groups (id, club_id, name, location) values ('$GR', '$CL', 'U9-C', 'Чиовани');
insert into sessions (id, group_id, starts_at, kind, source_key, class) values ('$SE', '$GR', (current_date - 3) + time '15:00', 'training', 'ATT|conc-return', 'regular');
insert into players (id, club_id, group_id, full_name, status) select ('00000000-0000-0000-0000-0000bf10d' || lpad(g::text, 3, '0'))::uuid, '$CL', '$GR', 'Игрок ' || g, 'active' from generate_series(1, 12) g;
SQL
# месяц занятия: «до» первое число этого месяца — месяц занятия абонементный; начало периода за 40 дней до него (не в будущем)
SMON=$(q -c "select date_trunc('month', tbilisi_day(starts_at))::date from sessions where id = '$SE'")
FROM=$(q -c "select ('$SMON'::date - interval '40 days')::date")
visits() { q -c "select count(*) from own_visits where player_id = '$1' and session_id = '$SE'"; }
perv() { q -c "update players set pay_mode = 'per_visit', pay_mode_from = '$FROM', pay_mode_until = null where id = '$1'" >/dev/null; }
ended() { q -c "update players set pay_mode = 'subscription', pay_mode_from = '$FROM', pay_mode_until = '$SMON' where id = '$1'" >/dev/null; }
att() { q -c "insert into attendance (session_id, player_id, status) values ('$SE', '$1', '$2')" >/dev/null; }

# смена режима держит строку игрока 2 с: $1 игрок, $2 режим, $3 дата, $4 файл вывода
setmode() { { as "$AD"; printf "begin;\nselect player_set_pay_mode('%s', '%s', '%s');\nselect pg_sleep(2);\ncommit;\n" "$1" "$2" "$3"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >"$T/$4.out" 2>&1; }
mark() { printf "begin;\n%s\nselect pg_sleep(%s);\ncommit;\n" "$2" "${3:-0.1}" | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >"$T/$1.out" 2>&1; }
sleeping() { for _ in $(seq 1 100); do [ "$(q -c "select count(*) from pg_stat_activity where datname = current_database() and state = 'active' and query like 'select pg_sleep(2)%'")" != 0 ] && return 0; sleep 0.1; done; return 1; }
ins() { echo "insert into attendance (session_id, player_id, status) values ('$SE', '$1', 'present');"; }
upd() { echo "update attendance set status = '$2' where session_id = '$SE' and player_id = '$1';"; }
barrier() { sleeping || { bad "барьер не достигнут: первая транзакция не дошла до паузы"; exit 1; }; }
chk() { # $1 игрок, $2 ожидаемое число визитов, $3 название
  [ "$(visits "$1")" = "$2" ] && ok "$3" || { bad "$3: визитов $(visits "$1"), ожидалось $2"; cat "$T"/*.out; }; }

# --- возврат на абонемент (per_visit -> subscription): месяц занятия становится абонементным ---
P=$(pl 1); perv "$P"
setmode "$P" subscription "$SMON" r1a & A=$!; barrier
mark r1b "$(ins "$P")" & B=$!
wait $A || bad "1: транзакция А с ошибкой"; wait $B || bad "1: транзакция Б с ошибкой"
chk "$P" 0 "возврат на абонемент открыт, потом отметка «Был»: визита нет"
P=$(pl 2); perv "$P"
mark r2b "$(ins "$P")" 2 & B=$!; barrier
setmode "$P" subscription "$SMON" r2a & A=$!
wait $A || bad "2: транзакция А с ошибкой"; wait $B || bad "2: транзакция Б с ошибкой"
chk "$P" 1 "отметка «Был» открыта, потом возврат на абонемент: ровно один визит"
P=$(pl 3); perv "$P"; att "$P" present
setmode "$P" subscription "$SMON" r3a & A=$!; barrier
mark r3b "$(upd "$P" absent)" & B=$!
wait $A || bad "3: транзакция А с ошибкой"; wait $B || bad "3: транзакция Б с ошибкой"
chk "$P" 1 "возврат на абонемент открыт, потом снятие отметки: визит остаётся (месяц уже абонементный)"
P=$(pl 4); perv "$P"; att "$P" present
mark r4b "$(upd "$P" absent)" 2 & B=$!; barrier
setmode "$P" subscription "$SMON" r4a & A=$!
wait $A || bad "4: транзакция А с ошибкой"; wait $B || bad "4: транзакция Б с ошибкой"
chk "$P" 0 "снятие отметки открыто, потом возврат на абонемент: визит удалён"

# --- повторный переход на «за визит» после закрытого периода ---
# повторный переход с прежней даты начала: занятие попадает в период «за визит»
RET="$FROM"
P=$(pl 5); ended "$P"; att "$P" present
setmode "$P" per_visit "$RET" r5a & A=$!; barrier
mark r5b "$(upd "$P" absent)" & B=$!
wait $A || bad "5: транзакция А с ошибкой"; wait $B || bad "5: транзакция Б с ошибкой"
chk "$P" 0 "переход на «за визит» открыт, потом снятие «Был»: лишнего визита нет"
P=$(pl 6); ended "$P"; att "$P" absent
setmode "$P" per_visit "$RET" r6a & A=$!; barrier
mark r6b "$(upd "$P" present)" & B=$!
wait $A || bad "6: транзакция А с ошибкой"; wait $B || bad "6: транзакция Б с ошибкой"
chk "$P" 1 "переход на «за визит» открыт, потом исправление на «Был»: ровно один визит"
P=$(pl 7); ended "$P"; att "$P" absent
mark r7b "$(upd "$P" present)" 2 & B=$!; barrier
setmode "$P" per_visit "$RET" r7a & A=$!
wait $A || bad "7: транзакция А с ошибкой"; wait $B || bad "7: транзакция Б с ошибкой"
chk "$P" 1 "исправление на «Был» открыто, потом переход на «за визит»: ровно один визит"
P=$(pl 8); ended "$P"; att "$P" present
mark r8b "$(upd "$P" absent)" 2 & B=$!; barrier
setmode "$P" per_visit "$RET" r8a & A=$!
wait $A || bad "8: транзакция А с ошибкой"; wait $B || bad "8: транзакция Б с ошибкой"
chk "$P" 0 "снятие «Был» открыто, потом переход на «за визит»: визитов нет"

dl=$(cat "$T"/*.out | grep -ci 'deadlock')
[ "$dl" = 0 ] && ok "взаимных блокировок нет" || { bad "взаимные блокировки: $dl"; cat "$T"/*.out; }
[ "$fail" = 0 ]
