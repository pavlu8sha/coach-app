#!/usr/bin/env bash
# Конкурентные проверки записи согласий (миграция 0162, #238 PR 2a). Условия приёмки: docs/CONSENT_PR2A_ACCEPTANCE.md.
# Две транзакции перекрываются намеренно: первая держит транзакцию открытой (pg_sleep), вторая стартует через секунду.
# Каждый сценарий проверяет: нет deadlock, нет дублей событий, итоговое состояние = последнее событие, инварианты версий целы.
# CONTROL=1: только сценарии 9-10 (прямые операции над версиями), для прогона на схеме PR 1 (только 0159) как контроль.
# Запуск из scripts/run-db-tests.sh после миграций и pgTAP-тестов: DB_NAME и PSQL берутся оттуда.
set -uo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
CONTROL="${CONTROL:-0}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
id() { printf '00000000-0000-0000-0000-%012x' "$1"; }
CLUB=$(id 49153)            # 0xc001
P() { id $((49408 + $1)); } # родители 0xc100+n
K() { id $((49664 + $1)); } # дети 0xc200+n
ADMIN=$(P 99)
as() { echo "select set_config('role','authenticated',true), set_config('request.jwt.claims', json_build_object('sub','$1','role','authenticated')::text, true);"; }
# race T1 T2: T1 стартует сразу, T2 через секунду; выводы в $TMP/t1.out, $TMP/t2.out
race() {
  $PSQL -q -d "$DB" -f "$1" >"$TMP/t1.out" 2>&1 & local a=$!
  sleep 1
  $PSQL -q -d "$DB" -f "$2" >"$TMP/t2.out" 2>&1 & local b=$!
  wait $a; wait $b
}
dead() { cat "$TMP/t1.out" "$TMP/t2.out" | grep -ci 'deadlock detected'; }
nev() { q -c "select count(*) from parental_consent_events where parent_user_id = '$1' and player_id = '$2' and consent_type = '$3' ${4:+and event = '$4'}"; }
status() { q -c "select coalesce((select status from parental_consents where parent_user_id = '$1' and player_id = '$2' and consent_type = '$3'), 'none')"; }
consistent() { # состояние = последнее событие пары и типа
  q -c "select count(*) from parental_consents c where c.parent_user_id = '$1' and c.player_id = '$2' and c.consent_type = '$3' and c.last_event_id is distinct from (select max(id) from parental_consent_events e where e.parent_user_id = c.parent_user_id and e.player_id = c.player_id and e.consent_type = c.consent_type)"; }
check() { # имя, условие (0/1 через test)
  if eval "$2"; then ok "$1"; else bad "$1"; cat "$TMP/t1.out" "$TMP/t2.out" 2>/dev/null | head -12; fi; }

# --- фикстура: родители P1..P12, дети K1..K12 со связями; версии
q <<SQL
insert into clubs (id, name) values ('$CLUB', 'Конкурентность согласий');
insert into users (id, telegram_id, display_name, is_admin) values ('$ADMIN', 993099, 'Админ', true);
SQL
for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do
q <<SQL
insert into users (id, telegram_id, display_name, is_admin) values ('$(P $n)', $((993100 + n)), 'Родитель $n', false);
insert into players (id, club_id, full_name) values ('$(K $n)', '$CLUB', 'Ребёнок $n');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('$(K $n)', '$(P $n)', 'lawyer-2026-11-v1', now());
SQL
done
V_DP1=$(id 49921); V_M1=$(id 49922)   # 0xc301.., текущие версии
q <<SQL
insert into consent_doc_versions (id, consent_type, version, effective_from) values
  ('$V_DP1', 'data_processing', 'conc-dp-1', now() - interval '2 hours'),
  ('$V_M1', 'media_publication', 'conc-m-1', now() - interval '2 hours');
SQL
accept_sql() { echo "select accept_consent('$2', '$3', '$4');"; }  # as user: accept_sql P K type version

if [ "$CONTROL" != 1 ]; then
# --- 1. двойное принятие
cat >"$TMP/a.sql" <<SQL
begin; $(as "$(P 1)") select accept_consent('$(K 1)', 'data_processing', '$V_DP1'); select pg_sleep(3); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; $(as "$(P 1)") select accept_consent('$(K 1)', 'data_processing', '$V_DP1'); commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "1. двойное принятие: одно событие, без дедлока" '[ "$(nev $(P 1) $(K 1) data_processing)" = 1 ] && [ "$(dead)" = 0 ] && [ "$(consistent $(P 1) $(K 1) data_processing)" = 0 ]'

# --- 2/3. принятие против публикации новой версии и закрытия прежней (media)
V_M2=$(id 49923); V_M3=$(id 49924)
# 2a: публикация первой (держит транзакцию), принятие прежней версии вторым: после коммита версия не текущая, принятие отклоняется
cat >"$TMP/a.sql" <<SQL
begin; insert into consent_doc_versions (id, consent_type, version, effective_from) values ('$V_M2', 'media_publication', 'conc-m-2', now());
update consent_doc_versions set accepting = false where id = '$V_M1'; select pg_sleep(3); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; $(as "$(P 2)") select accept_consent('$(K 2)', 'media_publication', '$V_M1'); commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "2/3a. публикация новой версии, затем принятие прежней: принятие отклонено, согласия нет" 'grep -q "consent version changed" "$TMP/t2.out" && [ "$(nev $(P 2) $(K 2) media_publication)" = 0 ] && [ "$(dead)" = 0 ]'
# 2b: принятие первым (держит), публикация и закрытие прежней вторым: ждёт, принятие остаётся, но устаревает
cat >"$TMP/a.sql" <<SQL
begin; $(as "$(P 3)") select accept_consent('$(K 3)', 'media_publication', '$V_M2'); select pg_sleep(3); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; insert into consent_doc_versions (id, consent_type, version, effective_from) values ('$V_M3', 'media_publication', 'conc-m-3', now());
update consent_doc_versions set accepting = false where id = '$V_M2'; commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "2/3b. принятие, затем публикация и закрытие: принятие устарело, закрытой текущей нет" '[ "$(status $(P 3) $(K 3) media_publication)" = granted ] && [ "$(q -c "select has_consent('"'"'$(P 3)'"'"', '"'"'$(K 3)'"'"', '"'"'media_publication'"'"')")" = f ] && [ "$(q -c "select accepting from consent_doc_versions where id = consent_current_version('"'"'media_publication'"'"')")" = t ] && [ "$(dead)" = 0 ]'

# --- 4. принятие против удаления связи
cat >"$TMP/a.sql" <<SQL
begin; delete from player_guardians where user_id = '$(P 4)' and player_id = '$(K 4)'; select pg_sleep(3); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; $(as "$(P 4)") select accept_consent('$(K 4)', 'data_processing', '$V_DP1'); commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "4a. удаление связи, затем принятие: отказ, granted без связи нет" 'grep -q "no guardian link" "$TMP/t2.out" && [ "$(q -c "select count(*) from parental_consents c where status = '"'"'granted'"'"' and not exists (select 1 from player_guardians g where g.user_id = c.parent_user_id and g.player_id = c.player_id)")" = 0 ] && [ "$(dead)" = 0 ]'
q -c "insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('$(K 4)', '$(P 4)', 'lawyer-2026-11-v1', now())"
cat >"$TMP/a.sql" <<SQL
begin; $(as "$(P 4)") select accept_consent('$(K 4)', 'data_processing', '$V_DP1'); select pg_sleep(3); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; delete from player_guardians where user_id = '$(P 4)' and player_id = '$(K 4)'; commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "4b. принятие, затем удаление связи: принято и отозвано системой, состояние = последнее событие" '[ "$(status $(P 4) $(K 4) data_processing)" = revoked ] && [ "$(nev $(P 4) $(K 4) data_processing granted)" = 1 ] && [ "$(nev $(P 4) $(K 4) data_processing revoked)" = 1 ] && [ "$(consistent $(P 4) $(K 4) data_processing)" = 0 ] && [ "$(dead)" = 0 ]'

# --- 5. отзыв против удаления связи: ровно один отзыв
q <<SQL
begin; $(as "$(P 5)") select accept_consent('$(K 5)', 'data_processing', '$V_DP1'); commit;
SQL
cat >"$TMP/a.sql" <<SQL
begin; $(as "$(P 5)") select revoke_parent_consent('$(K 5)', 'data_processing'); select pg_sleep(3); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; delete from player_guardians where user_id = '$(P 5)' and player_id = '$(K 5)'; commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "5a. отзыв, затем удаление связи: одно событие revoked" '[ "$(nev $(P 5) $(K 5) data_processing revoked)" = 1 ] && [ "$(consistent $(P 5) $(K 5) data_processing)" = 0 ] && [ "$(dead)" = 0 ]'
q -c "insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('$(K 5)', '$(P 5)', 'lawyer-2026-11-v1', now())"
q <<SQL
begin; $(as "$(P 5)") select accept_consent('$(K 5)', 'data_processing', '$V_DP1'); commit;
SQL
cat >"$TMP/a.sql" <<SQL
begin; delete from player_guardians where user_id = '$(P 5)' and player_id = '$(K 5)'; select pg_sleep(3); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; $(as "$(P 5)") select revoke_parent_consent('$(K 5)', 'data_processing'); commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "5b. удаление связи, затем отзыв: по одному событию revoked на каждое принятие (всего два)" '[ "$(nev $(P 5) $(K 5) data_processing revoked)" = 2 ] && [ "$(nev $(P 5) $(K 5) data_processing granted)" = 2 ] && [ "$(consistent $(P 5) $(K 5) data_processing)" = 0 ] && [ "$(dead)" = 0 ]'

# --- 6. удаление связи против повторной привязки (decide_link)
q <<SQL
begin; $(as "$(P 6)") select accept_consent('$(K 6)', 'data_processing', '$V_DP1'); commit;
insert into link_requests (user_id, player_id, status) values ('$(P 6)', '$(K 6)', 'pending');
SQL
RID=$(q -c "select id from link_requests where user_id = '$(P 6)' and player_id = '$(K 6)'")
cat >"$TMP/a.sql" <<SQL
begin; delete from player_guardians where user_id = '$(P 6)' and player_id = '$(K 6)'; select pg_sleep(3); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; $(as "$ADMIN") select decide_link('$RID', true); commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "6. удаление связи против повторной привязки: итог revoked, нового принятия нет, одно событие revoked" '[ "$(status $(P 6) $(K 6) data_processing)" = revoked ] && [ "$(nev $(P 6) $(K 6) data_processing revoked)" = 1 ] && [ "$(q -c "select has_consent('"'"'$(P 6)'"'"', '"'"'$(K 6)'"'"', '"'"'data_processing'"'"')")" = f ] && [ "$(dead)" = 0 ]'

# --- 7. принятие против отзыва одной пары
q <<SQL
begin; $(as "$(P 7)") select accept_consent('$(K 7)', 'data_processing', '$V_DP1'); commit;
SQL
cat >"$TMP/a.sql" <<SQL
begin; $(as "$(P 7)") select revoke_parent_consent('$(K 7)', 'data_processing'); select pg_sleep(3); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; $(as "$(P 7)") select accept_consent('$(K 7)', 'data_processing', '$V_DP1'); commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "7. отзыв, затем принятие: итог granted, три события, состояние = последнее событие" '[ "$(status $(P 7) $(K 7) data_processing)" = granted ] && [ "$(nev $(P 7) $(K 7) data_processing)" = 3 ] && [ "$(consistent $(P 7) $(K 7) data_processing)" = 0 ] && [ "$(dead)" = 0 ]'

# --- 8. два типа одним родителем параллельно
cat >"$TMP/a.sql" <<SQL
begin; $(as "$(P 8)") select accept_consent('$(K 8)', 'data_processing', '$V_DP1'); select pg_sleep(3); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; $(as "$(P 8)") select accept_consent('$(K 8)', 'media_publication', '$V_M3'); commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "8. два типа параллельно: оба приняты независимо" '[ "$(status $(P 8) $(K 8) data_processing)" = granted ] && [ "$(status $(P 8) $(K 8) media_publication)" = granted ] && [ "$(dead)" = 0 ]'
fi

# --- 9. два администратора правят версии одного типа в обратном порядке (future-версии: открыты, без событий)
FX=$(id 49931); FY=$(id 49932); GX=$(id 49933); GY=$(id 49934)
q <<SQL
insert into consent_doc_versions (id, consent_type, version, effective_from) values
  ('$FX', 'media_publication', 'conc-fx', now() + interval '30 days'), ('$FY', 'media_publication', 'conc-fy', now() + interval '31 days'),
  ('$GX', 'data_processing', 'conc-gx', now() + interval '30 days'), ('$GY', 'media_publication', 'conc-gy', now() + interval '32 days');
SQL
cat >"$TMP/a.sql" <<SQL
begin; update consent_doc_versions set effective_from = now() + interval '40 days' where id = '$FX'; select pg_sleep(2); update consent_doc_versions set effective_from = now() + interval '41 days' where id = '$FY'; commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; update consent_doc_versions set effective_from = now() + interval '42 days' where id = '$FY'; update consent_doc_versions set effective_from = now() + interval '43 days' where id = '$FX'; commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "9. два администратора, версии одного типа в обратном порядке: без дедлока" '[ "$(dead)" = 0 ]'
# --- 10. то же для версий разных типов (ключ общий на все типы)
cat >"$TMP/a.sql" <<SQL
begin; update consent_doc_versions set effective_from = now() + interval '50 days' where id = '$GX'; select pg_sleep(2); update consent_doc_versions set effective_from = now() + interval '51 days' where id = '$GY'; commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; update consent_doc_versions set effective_from = now() + interval '52 days' where id = '$GY'; update consent_doc_versions set effective_from = now() + interval '53 days' where id = '$GX'; commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "10. версии разных типов в обратном порядке: без дедлока" '[ "$(dead)" = 0 ]'

if [ "$CONTROL" != 1 ]; then
# --- 11. правка версии против идущего принятия: правка ждёт принятие
# время окончания правки пишем в таблицу, чтобы сравнить с моментом commit принятия
q -c "create table if not exists conc_marks (k text primary key, t double precision)"
cat >"$TMP/a.sql" <<SQL
begin; $(as "$(P 9)") select accept_consent('$(K 9)', 'data_processing', '$V_DP1'); select pg_sleep(3); reset role; insert into conc_marks values ('accept_end', extract(epoch from clock_timestamp())); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; update consent_doc_versions set effective_from = now() + interval '60 days' where id = '$GX'; insert into conc_marks values ('edit_done', extract(epoch from clock_timestamp())); commit;
SQL
# принятие стартует первым и держит общую блокировку; правка (исключительная) должна завершиться после принятия
race "$TMP/a.sql" "$TMP/b.sql"
check "11. правка версии против идущего принятия: правка ждёт завершения принятия" '[ "$(q -c "select (select t from conc_marks where k = '"'"'edit_done'"'"') >= (select t from conc_marks where k = '"'"'accept_end'"'"')")" = t ] && [ "$(dead)" = 0 ]'

# --- 12. прямая запись события в обход функций (владелец базы) против удаления связи
q <<SQL
begin; $(as "$(P 10)") select accept_consent('$(K 10)', 'data_processing', '$V_DP1'); commit;
SQL
cat >"$TMP/a.sql" <<SQL
begin;
insert into parental_consent_events (parent_user_id, player_id, consent_type, version_id, event, source) values ('$(P 10)', '$(K 10)', 'media_publication', '$V_M3', 'granted', 'admin');
select pg_sleep(3); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; delete from player_guardians where user_id = '$(P 10)' and player_id = '$(K 10)'; commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "12. прямая вставка события владельцем базы (service_role это запрещено с раунда 2) против удаления связи: без дедлока, обе транзакции завершены" '[ "$(dead)" = 0 ] && ! grep -qi "error" "$TMP/t1.out" "$TMP/t2.out" && [ "$(nev $(P 10) $(K 10) data_processing revoked)" = 1 ]'

# --- 13. повторный revoked: (а) granted -> удаление связи -> одно событие; (б) отозвано родителем -> удаление связи -> нового события нет
q <<SQL
begin; $(as "$(P 11)") select accept_consent('$(K 11)', 'data_processing', '$V_DP1'); commit;
delete from player_guardians where user_id = '$(P 11)' and player_id = '$(K 11)';
begin; $(as "$(P 12)") select accept_consent('$(K 12)', 'data_processing', '$V_DP1'); select revoke_parent_consent('$(K 12)', 'data_processing'); commit;
delete from player_guardians where user_id = '$(P 12)' and player_id = '$(K 12)';
SQL
check "13а. granted, затем удаление связи: ровно одно revoked" '[ "$(nev $(P 11) $(K 11) data_processing revoked)" = 1 ]'
check "13б. отозвано родителем, затем удаление связи: повторного revoked нет" '[ "$(nev $(P 12) $(K 12) data_processing revoked)" = 1 ] && [ "$(nev $(P 12) $(K 12) data_processing)" = 2 ]'

# --- 14. хронология: транзакция, начатая раньше, но записавшая событие позже, не получает более раннее время (occurred_at не убывает по id)
q <<SQL
begin; $(as "$(P 13)") select accept_consent('$(K 13)', 'data_processing', '$V_DP1'); commit;
SQL
cat >"$TMP/a.sql" <<SQL
begin; select pg_sleep(2); $(as "$(P 13)") select revoke_parent_consent('$(K 13)', 'data_processing'); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; $(as "$(P 13)") select revoke_parent_consent('$(K 13)', 'data_processing'); select accept_consent('$(K 13)', 'data_processing', '$V_DP1'); commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "14. хронология: время событий пары не убывает по порядку записи" '[ "$(q -c "select count(*) from parental_consent_events a join parental_consent_events b on b.parent_user_id = a.parent_user_id and b.player_id = a.player_id and b.consent_type = a.consent_type and b.id > a.id and b.occurred_at < a.occurred_at")" = 0 ]'
q <<SQL
begin; $(as "$(P 14)") select accept_consent('$(K 14)', 'data_processing', '$V_DP1'); commit;
SQL
# тест хронологии на одной паре и одном типе: поздний старт, ранняя запись
cat >"$TMP/a.sql" <<SQL
begin; select pg_sleep(2); $(as "$(P 14)") select revoke_parent_consent('$(K 14)', 'data_processing'); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; $(as "$(P 14)") select revoke_parent_consent('$(K 14)', 'data_processing'); select pg_sleep(0.2); select accept_consent('$(K 14)', 'data_processing', '$V_DP1'); commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "14б. одна пара и тип: порядок записи и время событий согласованы" '[ "$(q -c "select count(*) from parental_consent_events a join parental_consent_events b on b.parent_user_id = a.parent_user_id and b.player_id = a.player_id and b.consent_type = a.consent_type and b.id > a.id and b.occurred_at < a.occurred_at")" = 0 ] && [ "$(consistent $(P 14) $(K 14) data_processing)" = 0 ] && [ "$(dead)" = 0 ]'

# --- 15. длинная правка версий не подвешивает принятие: родитель получает отказ по таймауту блокировки, событие не пишется
q <<SQL
insert into consent_doc_versions (id, consent_type, version, effective_from) values ('$(id 49941)', 'media_publication', 'conc-lt', now() + interval '90 days');
SQL
cat >"$TMP/a.sql" <<SQL
begin; update consent_doc_versions set effective_from = effective_from where id = '$(id 49941)'; select pg_sleep(8); commit;
SQL
q -c "insert into users (id, telegram_id, display_name, is_admin) values ('$(P 15)', 993115, 'Родитель 15', false); insert into players (id, club_id, full_name) values ('$(K 15)', '$CLUB', 'Ребёнок 15'); insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('$(K 15)', '$(P 15)', 'lawyer-2026-11-v1', now())"
cat >"$TMP/b.sql" <<SQL
begin; $(as "$(P 15)") select accept_consent('$(K 15)', 'data_processing', '$V_DP1'); commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "15. правка версий дольше таймаута: принятие получает отказ по lock timeout, событий нет" 'grep -qi "lock timeout\|could not obtain lock" "$TMP/t2.out" && [ "$(nev $(P 15) $(K 15) data_processing)" = 0 ]'
# --- 15б. Н-C: более строгий таймаут вызывающего не ослабляется до 5 с (1 с вызывающего действует внутри функции)
q -c "insert into users (id, telegram_id, display_name, is_admin) values ('$(P 19)', 993119, 'Родитель 19', false); insert into players (id, club_id, full_name) values ('$(K 19)', '$CLUB', 'Ребёнок 19'); insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('$(K 19)', '$(P 19)', 'lawyer-2026-11-v1', now())"
cat >"$TMP/a.sql" <<SQL
begin; update consent_doc_versions set effective_from = effective_from where id = '$(id 49941)'; select pg_sleep(6); commit;
SQL
cat >"$TMP/b.sql" <<SQL
\set ON_ERROR_STOP 0
select extract(epoch from clock_timestamp()) as t0 \gset
begin; set local lock_timeout = '1s'; $(as "$(P 19)") select accept_consent('$(K 19)', 'data_processing', '$V_DP1'); rollback;
select round((extract(epoch from clock_timestamp()) - :t0)::numeric, 1) as waited;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
W15=$(grep -A2 'waited' "$TMP/t2.out" | grep -oE '^ *[0-9]+\.[0-9]' | tr -d ' ' | head -1)
check "15б. таймаут вызывающего 1 с не поднимается до 5 с: отказ по lock timeout примерно через 1 с (ждали ${W15:-?} с), событий нет" 'grep -qi "lock timeout" "$TMP/t2.out" && [ -n "$W15" ] && awk -v w="$W15" "BEGIN{exit !(w < 3)}" && [ "$(nev $(P 19) $(K 19) data_processing)" = 0 ]'

CUR_DP=$(q -c "select consent_current_version('data_processing')")
for n in 16 17 18; do
q -c "insert into users (id, telegram_id, display_name, is_admin) values ('$(P $n)', $((993100 + n)), 'Родитель $n', false); insert into players (id, club_id, full_name) values ('$(K $n)', '$CLUB', 'Ребёнок $n'); insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values ('$(K $n)', '$(P $n)', 'lawyer-2026-11-v1', now())"
done

# --- 16. Н-F (принятое ограничение): две транзакции, каждая и принимает согласие, и правит версии. PostgreSQL обнаруживает
#     дедлок и откатывает одну целиком; вторая завершается; частичных записей нет, состояние = последнее событие.
cat >"$TMP/a.sql" <<SQL
begin; $(as "$(P 16)") select accept_consent('$(K 16)', 'data_processing', '$CUR_DP'); reset role; select pg_sleep(2);
update consent_doc_versions set accepting = accepting where id = '$CUR_DP'; commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; $(as "$(P 17)") select accept_consent('$(K 17)', 'data_processing', '$CUR_DP'); reset role;
update consent_doc_versions set accepting = accepting where id = '$CUR_DP'; commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "16. смешанные транзакции (принятие + правка версий): ровно один откат по дедлоку, одно событие, состояния согласованы" '[ "$(dead)" = 1 ] && [ $(( $(nev $(P 16) $(K 16) data_processing) + $(nev $(P 17) $(K 17) data_processing) )) = 1 ] && [ "$(consistent $(P 16) $(K 16) data_processing)" = 0 ] && [ "$(consistent $(P 17) $(K 17) data_processing)" = 0 ] && [ "$(q -c "select count(*) from parental_consents where parent_user_id in ('"'"'$(P 16)'"'"', '"'"'$(P 17)'"'"') and status = '"'"'granted'"'"' and last_event_id is null")" = 0 ]'

# --- 17. Н-E (принятое ограничение): удаление связи ждёт правку версий без таймаута и завершается после неё, без дедлока,
#     системный отзыв записан один раз
q <<SQL
begin; $(as "$(P 18)") select accept_consent('$(K 18)', 'data_processing', '$CUR_DP'); commit;
SQL
cat >"$TMP/a.sql" <<SQL
begin; update consent_doc_versions set accepting = accepting where id = '$CUR_DP'; select pg_sleep(3);
insert into conc_marks values ('e17_done', extract(epoch from clock_timestamp())); commit;
SQL
cat >"$TMP/b.sql" <<SQL
begin; delete from player_guardians where user_id = '$(P 18)' and player_id = '$(K 18)';
insert into conc_marks values ('d17_done', extract(epoch from clock_timestamp())); commit;
SQL
race "$TMP/a.sql" "$TMP/b.sql"
check "17. удаление связи во время правки версий: ждёт её завершения, без ошибок и дедлока, один системный отзыв" '[ "$(q -c "select (select t from conc_marks where k = '"'"'d17_done'"'"') >= (select t from conc_marks where k = '"'"'e17_done'"'"')")" = t ] && [ "$(dead)" = 0 ] && ! grep -qi "error" "$TMP/t1.out" "$TMP/t2.out" && [ "$(nev $(P 18) $(K 18) data_processing revoked)" = 1 ] && [ "$(status $(P 18) $(K 18) data_processing)" = revoked ]'
fi

# --- итог: инварианты версий
bad_types=$(q -c "select count(*) from (select distinct consent_type t from consent_doc_versions) x where (select accepting from consent_doc_versions where id = consent_current_version(x.t)) is not true")
[ "$bad_types" = 0 ] && ok "после всех сценариев у каждого типа текущая версия открыта" || bad "типов с закрытой текущей версией: $bad_types"
[ "$fail" = 0 ]
