#!/usr/bin/env bash
# Проверка конкурентных операций RSVP (миграция 0134): настоящие параллельные сессии, а не один pgTAP-транзакционный прогон.
# Запуск из scripts/run-db-tests.sh после миграций на временной БД: DB_NAME и PSQL берутся оттуда. Тестовые данные остаются (опубликованные матчи удалить нельзя), БД удаляется скриптом.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1"; }
CL=00000000-0000-0000-0000-00000000c0f1; CO=00000000-0000-0000-0000-0000000000f1
P1=00000000-0000-0000-0000-0000000000f2; P2=00000000-0000-0000-0000-0000000000f3
PL=00000000-0000-0000-0000-00000000f001; GR=00000000-0000-0000-0000-0000000000f4
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность');
insert into users (id, telegram_id, display_name, is_admin) values ('$CO', 990001, 'Тренер', false), ('$P1', 990002, 'Родитель 1', false), ('$P2', 990003, 'Родитель 2', false);
insert into groups (id, club_id, name) values ('$GR', '$CL', 'UC');
insert into coach_groups (user_id, group_id) values ('$CO', '$GR');
insert into players (id, club_id, group_id, full_name) values ('$PL', '$CL', '$GR', 'Игрок Конкурентный');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('$PL', '$P1', 't', now()), ('$PL', '$P2', 't', now());
SQL
trap '' EXIT

new_match() {  # печатает id опубликованного матча, до начала 3 дня
  { as "$CO"; echo "select match_rsvp_create_draft('$CL', 'game', 'UC', 'Соперник', now() + interval '3 days', null, null, null);"; } | $PSQL -q -t -A -d "$DB" | tail -1
}
M=$(new_match)
{ as "$CO"; echo "select match_rsvp_invite('$M', array['$PL']::uuid[]); select match_rsvp_publish('$M');"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null

# 1. Два родителя отвечают одновременно по 20 раз: ошибок нет, остаётся ровно одно приглашение с одним из двух ответов и согласованным автором
run_parent() { local who=$1 resp=$2; for _ in $(seq 1 20); do echo "select match_rsvp_answer('$M', '$PL', '$resp');"; done | { as "$who"; cat; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null; }
run_parent "$P1" yes & A=$!; run_parent "$P2" no & B=$!
wait $A && wait $B && ok "параллельные ответы двух родителей без ошибок" || bad "параллельные ответы двух родителей без ошибок"
rows=$(q -c "select count(*) from match_invitations where match_id = '$M'")
state=$(q -c "select response || ':' || (responded_by = '$P1' and response = 'yes' or responded_by = '$P2' and response = 'no')::text from match_invitations where match_id = '$M'")
[ "$rows" = 1 ] && ok "одно приглашение на ребёнка" || bad "одно приглашение на ребёнка ($rows)"
case "$state" in yes:true|no:true) ok "ответ и автор согласованы ($state)";; *) bad "ответ и автор согласованы ($state)";; esac

# 2. Ответ родителя против переноса: перенос держит блокировку матча, ответ ждёт и после переноса записывается уже в новом состоянии
{ as "$CO"; echo "begin; select match_rsvp_reschedule('$M', now() + interval '8 days'); select pg_sleep(2); commit;"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null & R=$!
sleep 0.7
t0=$(date +%s.%N)
{ as "$P1"; echo "select match_rsvp_answer('$M', '$PL', 'yes');"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null
t1=$(date +%s.%N); wait $R
waited=$(echo "$t1 - $t0 > 0.8" | bc -l)
[ "$waited" = 1 ] && ok "ответ дождался переноса (не потерялся и не прошёл по старому состоянию)" || bad "ответ дождался переноса"
st=$(q -c "select response || ':' || (select rescheduled_count from matches where id = '$M') from match_invitations where match_id = '$M'")
[ "$st" = "yes:1" ] && ok "итог: перенос применён, ответ записан после него ($st)" || bad "итог переноса и ответа ($st)"

# 3. Ответ против отмены: отмена идёт первой, ответ после неё отклоняется, состояние не повреждено
{ as "$CO"; echo "begin; select match_rsvp_cancel('$M', 'тест'); select pg_sleep(2); commit;"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null & R=$!
sleep 0.7
if { as "$P2"; echo "select match_rsvp_answer('$M', '$PL', 'no');"; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null 2>&1; then bad "ответ после отмены отклонён"; else ok "ответ после отмены отклонён"; fi
wait $R
st=$(q -c "select response || ':' || (select lifecycle_status from matches where id = '$M') from match_invitations where match_id = '$M'")
[ "$st" = "yes:cancelled" ] && ok "итог: отмена, прежний ответ сохранён ($st)" || bad "итог отмены ($st)"

# 4. Одновременное приглашение одного игрока двумя сессиями тренера: одна строка, без ошибок уникальности
M2=$(new_match)
inv() { { as "$CO"; for _ in 1 2 3 4 5; do echo "select match_rsvp_invite('$M2', array['$PL']::uuid[]);"; done; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null; }
inv & A=$!; inv & B=$!
wait $A && wait $B && ok "параллельное добавление состава без ошибок" || bad "параллельное добавление состава без ошибок"
n=$(q -c "select count(*) from match_invitations where match_id = '$M2'")
[ "$n" = 1 ] && ok "в составе один игрок, без дублей" || bad "в составе один игрок ($n)"

[ "$fail" = 0 ] && echo "Конкурентные проверки RSVP прошли" || { echo "ЕСТЬ ПАДЕНИЯ (конкурентность RSVP)"; exit 1; }
