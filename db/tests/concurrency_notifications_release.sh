#!/usr/bin/env bash
# Конкурентные проверки release_notifications (миграция 0184, REL-02, замечание к PR #623, условие Q4а).
# Две сессии перекрываются намеренно (pg_sleep). Проверяется: старый запуск tg-notify (выдача A) не снимает более новую выдачу
# той же строки другим запуском (B), даже если его release ждёт блокировку, пока B ещё не зафиксирован; release, держащий
# строку, не даёт выдать её второй раз; два одновременных release одной выдачи возвращают строку один раз. Без deadlock и ошибок.
# Запуск из scripts/run-db-tests.sh после миграций: DB_NAME и PSQL берутся оттуда.
set -uo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
U='00000000-0000-0000-0000-00000000cf01'
svc() { echo "select set_config('role','service_role',true), set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"; }

q <<SQL
insert into users (id, telegram_id, display_name, is_admin) values ('$U', 9882001, 'Синтетик очередь', true) on conflict do nothing;
delete from notifications;  -- чужие строки после предыдущих сценариев не должны попадать в пачку
insert into notifications (user_id, kind, text) values ('$U', 'syn_rel', 'R1');
SQL
claim() { q -c "$(svc) select claim_token from claim_notifications(10) where text = '$1';" | tail -1; }
row() { q -c "select attempts || '|' || coalesce(claimed_at::text, '-') || '|' || coalesce(claim_token::text, '-') || '|' || state from notifications where text = '$1'"; }
age() { q -c "update notifications set claimed_at = now() - interval '5 minutes' where text = '$1'" >/dev/null; }
id1=$(q -c "select id from notifications where text = 'R1'")

# 1. A выдал R1; закрепление истекло; B выдаёт R1 заново в открытой транзакции и держит её 2 с;
#    A в это время вызывает release со своим токеном и ждёт блокировку строки. После фиксации B release A не должен ничего снять.
TA=$(claim R1); age R1
cat > "$TMP/b.sql" <<SQL
begin; $(svc) select 'B:' || claim_token from claim_notifications(10) where text = 'R1'; select pg_sleep(2); commit;
SQL
cat > "$TMP/a.sql" <<SQL
begin; $(svc) select 'A:' || release_notifications(array['$id1'::uuid], '$TA'::uuid); commit;
SQL
$PSQL -q -t -A -d "$DB" -f "$TMP/b.sql" > "$TMP/b.out" 2>&1 & pb=$!
sleep 1
$PSQL -q -t -A -d "$DB" -f "$TMP/a.sql" > "$TMP/a.out" 2>&1 & pa=$!
wait $pb; wait $pa
TB=$(grep -o '^B:.*' "$TMP/b.out" | cut -c3-)
REL=$(grep -o '^A:.*' "$TMP/a.out" | cut -c3-)
R=$(row R1)
if [ -n "$TB" ] && [ "$TB" != "$TA" ] && [ "$REL" = "0" ] && [ "$(echo "$R" | cut -d'|' -f1)" = "2" ] && [ "$(echo "$R" | cut -d'|' -f3)" = "$TB" ] && [ "$(echo "$R" | cut -d'|' -f2)" != "-" ] && ! grep -qi 'deadlock\|ERROR' "$TMP/a.out" "$TMP/b.out"; then
  ok "Q4а: release старой выдачи A, ждавший блокировку, не снял выдачу B (attempts=2, токен B, закрепление на месте)"
else bad "Q4а: release A против выдачи B (A вернул '$REL', строка $R, токены A=$TA B=$TB)"; cat "$TMP/a.out" "$TMP/b.out"; fi
[ "$(q -c "$(svc) select count(*) from claim_notifications(10) where text = 'R1';" | tail -1)" = "0" ] && ok "Q4а: пока B держит строку, третьему запуску она не выдаётся" || bad "Q4а: строку выдали третьему запуску"

# 2. B (владелец) возвращает строку в открытой транзакции и держит её 2 с; параллельный claim не ждёт и строку не получает
#    (skip locked), после фиксации release строка выдаётся ровно один раз.
cat > "$TMP/c.sql" <<SQL
begin; $(svc) select 'C:' || release_notifications(array['$id1'::uuid], '$TB'::uuid); select pg_sleep(2); commit;
SQL
cat > "$TMP/d.sql" <<SQL
begin; $(svc) select 'D:' || count(*) from claim_notifications(10) where text = 'R1'; commit;
SQL
$PSQL -q -t -A -d "$DB" -f "$TMP/c.sql" > "$TMP/c.out" 2>&1 & pc=$!
sleep 1
$PSQL -q -t -A -d "$DB" -f "$TMP/d.sql" > "$TMP/d.out" 2>&1 & pd=$!
wait $pc; wait $pd
C=$(grep -o '^C:.*' "$TMP/c.out" | cut -c3-); D=$(grep -o '^D:.*' "$TMP/d.out" | cut -c3-)
R=$(row R1)
if [ "$C" = "1" ] && [ "$D" = "0" ] && [ "$R" = "1|-|-|pending" ] && ! grep -qi 'deadlock\|ERROR' "$TMP/c.out" "$TMP/d.out"; then
  ok "Q4: release владельца во время параллельного claim: строка не выдана дважды, возвращена (attempts=1, без закрепления)"
else bad "Q4: release во время claim (release '$C', claim '$D', строка $R)"; cat "$TMP/c.out" "$TMP/d.out"; fi
[ "$(q -c "$(svc) select count(*) from claim_notifications(10) where text = 'R1';" | tail -1)" = "1" ] && ok "Q4: после release строка выдаётся следующим запуском один раз" || bad "Q4: строка не выдана после release"

# 3. два одновременных release одной выдачи: строка возвращается один раз, attempts уменьшается один раз
T3=$(q -c "select claim_token from notifications where text = 'R1'")
cat > "$TMP/e.sql" <<SQL
begin; $(svc) select 'E:' || release_notifications(array['$id1'::uuid], '$T3'::uuid); select pg_sleep(2); commit;
SQL
cat > "$TMP/f.sql" <<SQL
begin; $(svc) select 'F:' || release_notifications(array['$id1'::uuid], '$T3'::uuid); commit;
SQL
$PSQL -q -t -A -d "$DB" -f "$TMP/e.sql" > "$TMP/e.out" 2>&1 & pe=$!
sleep 1
$PSQL -q -t -A -d "$DB" -f "$TMP/f.sql" > "$TMP/f.out" 2>&1 & pf=$!
wait $pe; wait $pf
E=$(grep -o '^E:.*' "$TMP/e.out" | cut -c3-); F=$(grep -o '^F:.*' "$TMP/f.out" | cut -c3-)
R=$(row R1)
if [ "$((E + F))" = "1" ] && [ "$R" = "1|-|-|pending" ] && ! grep -qi 'deadlock\|ERROR' "$TMP/e.out" "$TMP/f.out"; then
  ok "Q4: два одновременных release одной выдачи вернули строку один раз (attempts=1)"
else bad "Q4: два release ($E + $F, строка $R)"; cat "$TMP/e.out" "$TMP/f.out"; fi

q -c "delete from notifications where kind = 'syn_rel'" >/dev/null
[ "$fail" = 0 ] || exit 1
