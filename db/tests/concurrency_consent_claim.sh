#!/usr/bin/env bash
# Конкурентные проверки claim_notifications и отзыва согласия (миграция 0176, #238 PR 2c, условие У13).
# Две сессии перекрываются намеренно (pg_sleep). Проверяется: нет deadlock и ошибок, отзыв, зафиксированный до проверки,
# не даёт выдать строку; параллельные claim не выдают одну строку дважды; отзыв во время открытой транзакции claim не ломает ни одну из сторон.
# Запуск из scripts/run-db-tests.sh после миграций: DB_NAME и PSQL берутся оттуда.
set -uo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
id() { printf '00000000-0000-0000-0000-%012x' "$1"; }
CLUB=$(id 52225)   # 0xcc01
P() { id $((52480 + $1)); }  # родители 0xcd00+n
K() { id $((52736 + $1)); }  # дети 0xce00+n
VER=$(id 52993)
as() { echo "select set_config('role','authenticated',true), set_config('request.jwt.claims', json_build_object('sub','$1','role','authenticated')::text, true);"; }
svc() { echo "select set_config('role','service_role',true), set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"; }

q <<SQL
insert into clubs (id, name) values ('$CLUB', 'Конкурентность claim');
insert into users (id, telegram_id, display_name) values ('$(P 1)', 9881001, 'Р1'), ('$(P 2)', 9881002, 'Р2'), ('$(P 3)', 9881003, 'Р3');
insert into players (id, club_id, full_name) values ('$(K 1)', '$CLUB', 'Синтетик К1'), ('$(K 2)', '$CLUB', 'Синтетик К2'), ('$(K 3)', '$CLUB', 'Синтетик К3');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('$(K 1)', '$(P 1)', 'v', now()), ('$(K 2)', '$(P 2)', 'v', now()), ('$(K 3)', '$(P 3)', 'v', now());
insert into consent_doc_versions (id, consent_type, version, effective_from, coach_contacts) values ('$VER', 'data_processing', 'syn-claim-1', now() - interval '1 day', true);
delete from club_settings where club_id = '$CLUB' and key = 'consent.mode';
insert into club_settings (club_id, key, scope, value) values ('$CLUB', 'consent.mode', '', 'all');
SQL
VER=$(q -c "select consent_current_version('data_processing')" | head -1)   # текущая версия (после других сценариев в базе могут быть более новые)
for n in 1 2 3; do q -c "$(as "$(P $n)") select accept_consent('$(K $n)', 'data_processing', '$VER');" >/dev/null || { echo 'not ok - фикстура'; exit 1; }; done
q -c "delete from notifications" >/dev/null   # чужие строки очереди после предыдущих сценариев не должны занимать пачку
put() { q -c "insert into notifications (user_id, kind, text, player_ids) values ('$(P $1)', 'syn_claim', '$2', array['$(K $1)'::uuid])" >/dev/null; }
state() { q -c "select state from notifications where text = '$1'"; }
att() { q -c "select attempts from notifications where text = '$1'"; }

# 1. отзыв зафиксирован до claim: строка не выдаётся
put 1 C1
q -c "$(as "$(P 1)") select revoke_parent_consent('$(K 1)', 'data_processing');" >/dev/null
q -c "$(svc) select count(*) from claim_notifications(10) where text = 'C1';" | tail -1 > "$TMP/n1"
[ "$(cat $TMP/n1)" = "0" ] && [ "$(state C1)" = "skipped" ] && ok "У13: отзыв до проверки — строка не выдана, skipped" || bad "У13: отзыв до проверки (выдано $(cat $TMP/n1), состояние $(state C1))"

# 2. два параллельных claim: каждая строка выдаётся не больше одного раза, без deadlock
put 2 C2; put 3 C3
cat > "$TMP/a.sql" <<SQL
begin; $(svc) select text from claim_notifications(10) order by text; select pg_sleep(2); commit;
SQL
cat > "$TMP/b.sql" <<SQL
begin; $(svc) select text from claim_notifications(10) order by text; commit;
SQL
$PSQL -q -t -A -d "$DB" -f "$TMP/a.sql" > "$TMP/a.out" 2>&1 & pa=$!
sleep 1
$PSQL -q -t -A -d "$DB" -f "$TMP/b.sql" > "$TMP/b.out" 2>&1 & pb=$!
wait $pa; wait $pb
got=$(cat "$TMP/a.out" "$TMP/b.out" | grep -E '^C[23]$' | sort | tr '\n' ',')
if [ "$got" = "C2,C3," ] && ! grep -qi 'deadlock\|ERROR' "$TMP/a.out" "$TMP/b.out"; then ok "параллельные claim выдали каждую строку ровно один раз"; else bad "параллельные claim (получено: $got)"; cat "$TMP/a.out" "$TMP/b.out"; fi
q -c "update notifications set claimed_at = now() - interval '3 minutes' where text in ('C2', 'C3')" >/dev/null

# 3. отзыв во время открытой транзакции claim: обе стороны завершаются без ошибок; после коммита отзыва повторный claim строку подавляет
cat > "$TMP/c.sql" <<SQL
begin; $(svc) select text from claim_notifications(10) where text = 'C2' or text = 'C3' order by text; select pg_sleep(2); commit;
SQL
cat > "$TMP/d.sql" <<SQL
begin; $(as "$(P 2)") select revoke_parent_consent('$(K 2)', 'data_processing'); commit;
SQL
$PSQL -q -t -A -d "$DB" -f "$TMP/c.sql" > "$TMP/c.out" 2>&1 & pc=$!
sleep 1
$PSQL -q -t -A -d "$DB" -f "$TMP/d.sql" > "$TMP/d.out" 2>&1 & pd=$!
wait $pc; wait $pd
if ! grep -qi 'deadlock\|ERROR' "$TMP/c.out" "$TMP/d.out"; then ok "отзыв во время claim: без ошибок и deadlock"; else bad "отзыв во время claim"; cat "$TMP/c.out" "$TMP/d.out"; fi
q -c "update notifications set claimed_at = now() - interval '3 minutes' where text = 'C2'" >/dev/null
q -c "$(svc) select count(*) from claim_notifications(10) where text = 'C2';" | tail -1 > "$TMP/n3"
[ "$(cat $TMP/n3)" = "0" ] && [ "$(state C2)" = "skipped" ] && ok "У13: повторный claim после зафиксированного отзыва строку подавляет" || bad "У13: повторный claim после отзыва (выдано $(cat $TMP/n3), состояние $(state C2))"

# уборка
q -c "delete from notifications where kind = 'syn_claim'; delete from club_settings where club_id = '$CLUB' and key = 'consent.mode';" >/dev/null
[ "$fail" = 0 ] || exit 1
