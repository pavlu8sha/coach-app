#!/usr/bin/env bash
# Конкурентные операции над версиями согласий (миграция 0159): две транзакции одного типа не могут оставить
# закрытую текущую версию. Транзакции перекрываются по времени намеренно (pg_sleep внутри открытой транзакции).
# Запуск из scripts/run-db-tests.sh после миграций и pgTAP-тестов: DB_NAME и PSQL берутся оттуда.
set -uo pipefail
DB="${DB_NAME:-kickstart_test}"
PSQL="${PSQL:-psql}"
q() { $PSQL -q -v ON_ERROR_STOP=1 -t -A -d "$DB" "$@"; }
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
A1=00000000-0000-0000-0000-0000000c0a01; B1=00000000-0000-0000-0000-0000000c0b01
A2=00000000-0000-0000-0000-0000000c0a02; N2=00000000-0000-0000-0000-0000000c0b02

# Сценарий 1 (data_processing): А — прежняя версия, В — текущая; без событий.
#   Т1 переносит дату вступления В в будущее (текущей станет А), Т2 одновременно закрывает А (текущая В).
#   По отдельности каждая операция допустима; вместе они оставили бы закрытую текущую А.
q <<SQL
insert into consent_doc_versions (id, consent_type, version, effective_from) values
  ('$A1', 'data_processing', 'conc-dp-a', now() - interval '2 hours'),
  ('$B1', 'data_processing', 'conc-dp-b', now() - interval '1 hour');
SQL
{ echo "begin; update consent_doc_versions set effective_from = now() + interval '1 day' where id = '$B1'; select pg_sleep(3); commit;"; } | $PSQL -q -d "$DB" >"$TMP/t1.out" 2>&1 & P1=$!
sleep 1
{ echo "begin; update consent_doc_versions set accepting = false where id = '$A1'; commit;"; } | $PSQL -q -d "$DB" >"$TMP/t2.out" 2>&1 & P2=$!
wait $P1; wait $P2
cur_open=$(q -c "select accepting from consent_doc_versions where id = consent_current_version('data_processing')")
fails=$(cat "$TMP/t1.out" "$TMP/t2.out" | grep -c 'must stay open')
[ "$cur_open" = t ] && ok "гонка перенос даты + закрытие: после commit текущая версия открыта" || bad "гонка перенос даты + закрытие: текущая версия закрыта ($cur_open)"
[ "$fails" = 1 ] && ok "гонка перенос даты + закрытие: ровно одна из двух транзакций отклонена" || { bad "гонка перенос даты + закрытие: отклонено транзакций: $fails"; cat "$TMP/t1.out" "$TMP/t2.out"; }

# Сценарий 2 (media_publication): Т1 публикует новую версию N, Т2 в это время закрывает прежнюю А.
#   Т2 должна дождаться Т1 и после её commit закрытие допустимо (текущей стала N). Без блокировки Т2 была бы отклонена.
q <<SQL
insert into consent_doc_versions (id, consent_type, version, effective_from) values ('$A2', 'media_publication', 'conc-mp-a', now() - interval '2 hours');
SQL
{ echo "begin; insert into consent_doc_versions (id, consent_type, version, effective_from) values ('$N2', 'media_publication', 'conc-mp-n', now()); select pg_sleep(3); commit;"; } | $PSQL -q -d "$DB" >"$TMP/t3.out" 2>&1 & P3=$!
sleep 1
{ echo "begin; update consent_doc_versions set accepting = false where id = '$A2'; commit;"; } | $PSQL -q -d "$DB" >"$TMP/t4.out" 2>&1 & P4=$!
wait $P3; wait $P4
cur=$(q -c "select id from consent_doc_versions where id = consent_current_version('media_publication')")
a_open=$(q -c "select accepting from consent_doc_versions where id = '$A2'")
[ "$cur" = "$N2" ] && ok "публикация новой версии и закрытие прежней: текущая — новая, открытая" || bad "публикация и закрытие: текущая версия $cur"
[ "$a_open" = f ] && ok "публикация новой версии и закрытие прежней: прежняя закрыта после ожидания" || { bad "публикация и закрытие: прежняя осталась открытой"; cat "$TMP/t3.out" "$TMP/t4.out"; }

# Итог по обоим типам: нет типа, у которого текущая версия закрыта
bad_types=$(q -c "select count(*) from (select distinct consent_type t from consent_doc_versions) x where (select accepting from consent_doc_versions where id = consent_current_version(x.t)) is not true")
[ "$bad_types" = 0 ] && ok "после всех гонок у каждого типа текущая версия открыта" || bad "типов с закрытой текущей версией: $bad_types"
[ "$fail" = 0 ]
