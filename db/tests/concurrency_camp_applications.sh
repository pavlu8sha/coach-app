#!/usr/bin/env bash
# Конкурентное решение по гостевым заявкам (миграция 0161): два администратора одновременно подтверждают заявки на последнее место,
# одну и ту же заявку подтверждают дважды. Лимит не превышается, участник по заявке создаётся не более одного раза.
# Запуск из scripts/run-db-tests.sh после миграций: DB_NAME и PSQL берутся оттуда.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1"; }
CL=00000000-0000-0000-0000-0000cb0000c1
A1=00000000-0000-0000-0000-0000cb0000a1; A2=00000000-0000-0000-0000-0000cb0000a2
U1=00000000-0000-0000-0000-0000cb0000b1; U2=00000000-0000-0000-0000-0000cb0000b2; U3=00000000-0000-0000-0000-0000cb0000b3; U4=00000000-0000-0000-0000-0000cb0000b4
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность заявок');
insert into users (id, telegram_id, display_name, is_admin) values
  ('$A1', 990401, 'Админ 1', true), ('$A2', 990402, 'Админ 2', true),
  ('$U1', 990403, 'Гость 1', false), ('$U2', 990404, 'Гость 2', false), ('$U3', 990405, 'Гость 3', false), ('$U4', 990406, 'Гость 4', false);
insert into camps (club_id, name, starts_on, ends_on, capacity)
  select '$CL', 'Заявки-' || g, date '2099-01-01' + g, date '2099-02-01' + g, 1 from generate_series(1, 10) g;
insert into camp_tariffs (camp_id, name, price) select id, 'Тариф', 100 from camps where club_id = '$CL';
SQL

CAMPS=$(q -c "select id from camps where club_id = '$CL' order by name")
tariff() { q -c "select id from camp_tariffs where camp_id = '$1'"; }  # гость тарифы не читает, id берём заранее от владельца БД
{ as "$U1"; for c in $CAMPS; do echo "select camp_apply('$c', 'Первый Гость', date '2015-05-05', 'Мама', '+995555000001', '$(tariff $c)', null);"; done; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null
{ as "$U2"; for c in $CAMPS; do echo "select camp_apply('$c', 'Второй Гость', date '2016-06-06', 'Папа', '+995555000002', '$(tariff $c)', null);"; done; } | $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null

decide() {  # кто решает, чьи заявки (имя ребёнка); отказы «camp full» и «already decided» ожидаемы
  local who=$1 child=$2
  { as "$who"; for c in $CAMPS; do echo "select camp_application_decide((select id from camp_applications where camp_id = '$c' and child_name = '$child'), true, null);"; done; } | $PSQL -q -d "$DB" >/dev/null 2>&1 || true
}
decide "$A1" 'Первый Гость' & P=$!; decide "$A2" 'Второй Гость' & Q=$!; decide "$A2" 'Первый Гость' & R=$!; decide "$A1" 'Второй Гость' & S=$!
wait $P; wait $Q; wait $R; wait $S

over=$(q -c "select count(*) from (select camp_id from camp_participants p join camps c on c.id = p.camp_id where c.club_id = '$CL' and p.status = 'registered' group by camp_id having count(*) > 1) x")
full=$(q -c "select count(*) from (select camp_id from camp_participants p join camps c on c.id = p.camp_id where c.club_id = '$CL' and p.status = 'registered' group by camp_id having count(*) = 1) x")
approved=$(q -c "select count(*) from camp_applications a join camps c on c.id = a.camp_id where c.club_id = '$CL' and a.status = 'approved'")
linked=$(q -c "select count(*) from camp_applications a join camp_participants p on p.id = a.participant_id join camps c on c.id = a.camp_id where c.club_id = '$CL' and a.status = 'approved' and p.owner_user_id = a.owner_user_id")
parts=$(q -c "select count(*) from camp_participants p join camps c on c.id = p.camp_id where c.club_id = '$CL'")
[ "$over" = 0 ] && ok "заявки: ни один сбор не переполнен при одновременном подтверждении" || bad "заявки: переполнено сборов: $over"
[ "$full" = 10 ] && ok "заявки: на каждом сборе занято единственное место" || bad "заявки: занятых мест: $full из 10"
[ "$approved" = 10 ] && ok "заявки: подтверждено ровно по одной заявке на сбор" || bad "заявки: подтверждено $approved из 10"
[ "$linked" = 10 ] && [ "$parts" = 10 ] && ok "заявки: участник создан один раз и привязан к владельцу заявки" || bad "заявки: связано $linked, участников $parts (ожидалось 10 и 10)"

# Два пользователя одновременно подают заявку на одного и того же ребёнка: проходит одна, вторая получает «already applied», а не сырую ошибку индекса
q <<SQL
insert into camps (club_id, name, starts_on, ends_on) select '$CL', 'Гонка-' || g, date '2099-03-01' + g, date '2099-04-01' + g from generate_series(1, 10) g;
insert into camp_tariffs (camp_id, name, price) select id, 'Тариф', 100 from camps where club_id = '$CL' and name like 'Гонка-%';
SQL
RACE=$(q -c "select id from camps where club_id = '$CL' and name like 'Гонка-%' order by name")
racer() {  # вывод сохраняется, чтобы проверить текст отказов
  local who=$1 out=$2
  { as "$who"; for c in $RACE; do echo "select camp_apply('$c', 'Гонка Ребёнок', date '2015-07-07', 'Родитель', '+995555000009', '$(tariff $c)', null);"; done; } | $PSQL -q -d "$DB" >"$out" 2>&1 || true
}
racer "$U3" /tmp/race3.$$ & P=$!; racer "$U4" /tmp/race4.$$ & Q=$!; wait $P; wait $Q
raw=$(cat /tmp/race3.$$ /tmp/race4.$$ | grep -c "camp_applications_child_active" || true)
dups=$(q -c "select count(*) from (select camp_id from camp_applications a join camps c on c.id = a.camp_id where c.name like 'Гонка-%' and a.child_name = 'Гонка Ребёнок' group by camp_id having count(*) <> 1) x")
total=$(q -c "select count(*) from camp_applications a join camps c on c.id = a.camp_id where c.name like 'Гонка-%'")
rm -f /tmp/race3.$$ /tmp/race4.$$
[ "$raw" = 0 ] && ok "заявки: гонка двух пользователей не отдаёт сырую ошибку индекса" || bad "заявки: сырых ошибок индекса: $raw"
[ "$dups" = 0 ] && [ "$total" = 10 ] && ok "заявки: на каждого ребёнка и сбор ровно одна заявка при гонке" || bad "заявки: по сборам с не одной заявкой $dups, всего $total (ожидалось 0 и 10)"

[ "$fail" = 0 ] || exit 1
echo "Конкурентные проверки заявок прошли"
