#!/usr/bin/env bash
# Конкурентность этапа 3 сборов (миграция 0166): возврат и отмена платежа одновременно не уводят оплаченное в минус,
# отмена родителем и правка администратором не дают взаимной блокировки, замена не записывается для ещё записанного участника.
# Запуск из scripts/run-db-tests.sh после миграций: DB_NAME и PSQL берутся оттуда.
set -euo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
as() { printf "select set_config('role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1"; }
CL=00000000-0000-0000-0000-0000cc0000c1
AD=00000000-0000-0000-0000-0000cc0000a1; PA=00000000-0000-0000-0000-0000cc0000b1
N=4
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

q <<SQL
insert into clubs (id, name) values ('$CL', 'Конкурентность возвратов');
insert into users (id, telegram_id, display_name, is_admin) values ('$AD', 990501, 'Админ', true), ('$PA', 990502, 'Родитель', false);
insert into players (id, club_id, full_name, status) select ('00000000-0000-0000-0000-0000cc00d' || lpad(g::text, 3, '0'))::uuid, '$CL', 'Ребёнок ' || g, 'active' from generate_series(1, $N) g;
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) select id, '$PA', 't', now() from players where club_id = '$CL';
insert into camps (club_id, name, starts_on, ends_on) select '$CL', k || '-' || g, date '2099-01-01', date '2099-02-01' from generate_series(1, $N) g, (values ('Возврат'), ('Блокировка'), ('Замена')) v(k);
insert into camp_tariffs (camp_id, name, price) select id, 'Тариф', 1000 from camps where club_id = '$CL';
SQL
camp() { q -c "select id from camps where club_id = '$CL' and name = '$1'"; }
tariff() { q -c "select id from camp_tariffs where camp_id = '$1'"; }
kid() { printf '00000000-0000-0000-0000-0000cc00d%03d' "$1"; }
admin_sql() { { as "$AD"; cat; } | $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" | tail -1; }

# --- 1. Возврат и отмена платежа одновременно ---
: > "$T/a1.sql"; : > "$T/a2.sql"; as "$AD" >> "$T/a1.sql"; as "$AD" >> "$T/a2.sql"
for i in $(seq 1 $N); do
  c=$(camp "Возврат-$i"); t=$(tariff "$c")
  p=$(echo "select camp_register_guest('$c', 'Гость', null, '$t', null, null, null);" | admin_sql)
  pay=$(echo "select camp_pay('$p', 1000, 'payment', current_date, 'Наличные', null);" | admin_sql)
  echo "begin; select camp_refund('$p', 1000, null, 'r'); select pg_sleep(0.4); commit;" >> "$T/a1.sql"
  echo "select pg_sleep(0.15); select camp_cancel_payment('$pay');" >> "$T/a2.sql"
done
$PSQL -q -d "$DB" -f "$T/a1.sql" >/dev/null 2>&1 & A=$!
$PSQL -q -d "$DB" -f "$T/a2.sql" >/dev/null 2>&1 & B=$!
wait $A || true; wait $B || true
neg=$(q -c "select count(*) from (select participant_id from camp_payments p join camps c on c.id = p.camp_id where c.club_id = '$CL' group by participant_id having sum(amount) < 0) x")
ref=$(q -c "select count(*) from camp_payments p join camps c on c.id = p.camp_id where c.club_id = '$CL' and c.name like 'Возврат-%' and p.kind = 'refund'")
[ "$neg" = 0 ] && ok "возвраты: оплаченное не уходит в минус при одновременных возврате и отмене платежа" || bad "возвраты: участников с отрицательной суммой: $neg"
[ "$ref" = "$N" ] && ok "возвраты: на каждого участника прошла ровно одна из двух операций" || bad "возвраты: строк возврата $ref из $N"

# --- 2. Отмена родителем и правка администратором: без взаимной блокировки ---
: > "$T/b1.sql"; : > "$T/b2.sql"; as "$AD" >> "$T/b1.sql"; as "$PA" >> "$T/b2.sql"
for i in $(seq 1 $N); do
  c=$(camp "Блокировка-$i"); t=$(tariff "$c")
  p=$(echo "select camp_register('$c', '$(kid $i)', '$t', null, null, null);" | admin_sql)
  echo "begin; select camp_set_public('$c', null, null); select pg_sleep(0.4); select camp_update_participant('$p', null, 1000, null, 'админ', 'registered'); commit;" >> "$T/b1.sql"
  echo "select pg_sleep(0.15); select camp_parent_cancel('$p');" >> "$T/b2.sql"
done
$PSQL -q -d "$DB" -f "$T/b1.sql" >"$T/b1.out" 2>&1 & A=$!
$PSQL -q -d "$DB" -f "$T/b2.sql" >"$T/b2.out" 2>&1 & B=$!
wait $A || true; wait $B || true
dl=$(cat "$T/b1.out" "$T/b2.out" | grep -c "deadlock detected" || true)
canc=$(q -c "select count(*) from camp_participants p join camps c on c.id = p.camp_id where c.club_id = '$CL' and c.name like 'Блокировка-%' and p.status = 'cancelled'")
[ "$dl" = 0 ] && ok "блокировки: отмена родителем и правка администратором не дают взаимной блокировки" || bad "блокировки: взаимных блокировок: $dl"
[ "$canc" = "$N" ] && ok "блокировки: все отмены родителя прошли" || bad "блокировки: отменено $canc из $N"

# --- 3. Замена и одновременный возврат прежнего участника в статус «записан» ---
: > "$T/c1.sql"; : > "$T/c2.sql"; as "$AD" >> "$T/c1.sql"; as "$AD" >> "$T/c2.sql"
for i in $(seq 1 $N); do
  c=$(camp "Замена-$i"); t=$(tariff "$c")
  o=$(echo "select camp_register('$c', '$(kid $i)', '$t', null, null, null);" | admin_sql)
  echo "select camp_update_participant('$o', null, 1000, null, null, 'declined');" | admin_sql >/dev/null
  n=$(echo "select camp_register_guest('$c', 'Новый', null, '$t', null, null, null);" | admin_sql)
  echo "begin; select camp_update_participant('$o', null, 1000, null, null, 'registered'); select pg_sleep(0.4); commit;" >> "$T/c1.sql"
  echo "select pg_sleep(0.15); select camp_replace_participant('$o', '$n', 'замена');" >> "$T/c2.sql"
done
$PSQL -q -d "$DB" -f "$T/c1.sql" >/dev/null 2>&1 & A=$!
$PSQL -q -d "$DB" -f "$T/c2.sql" >/dev/null 2>&1 & B=$!
wait $A || true; wait $B || true
badrep=$(q -c "select count(*) from camp_participant_replacements r join camp_participants o on o.id = r.old_participant_id join camps c on c.id = r.camp_id where c.club_id = '$CL' and o.status = 'registered'")
[ "$badrep" = 0 ] && ok "замены: замена не записывается для участника, которого одновременно вернули в записанные" || bad "замены: замен с записанным прежним участником: $badrep"

[ "$fail" = 0 ] || exit 1
echo "Конкурентные проверки возвратов и отмен прошли"
