#!/usr/bin/env bash
# 0223 и 0224 на базе с привилегиями по умолчанию Supabase (alter default privileges ... grant ... to anon, authenticated, service_role)
# и на базе с клубом и версией правил от 2026-12-01. Запуск из scripts/run-db-tests.sh: DB_NAME и PSQL берутся оттуда.
set -uo pipefail
cd "$(dirname "$0")/../.."
DB="${DB_NAME:-kickstart_test}_mr"
PSQL="${PSQL:-psql}"
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
$PSQL -q -d postgres -c "drop database if exists $DB" -c "create database $DB" || exit 1
q() { $PSQL -q -At -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
q -f db/tests/setup_local.sql >/dev/null
q -c "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role" -c "alter default privileges in schema public grant all on tables to anon, authenticated, service_role"
for f in db/migrations/*.sql; do
  case "$f" in *0224_points_rules_match_rating*) continue ;; esac
  q -f "$f" >/dev/null 2>/tmp/mr_err.$$ || { bad "миграция $f не применилась: $(head -3 /tmp/mr_err.$$)"; $PSQL -q -d postgres -c "drop database if exists $DB"; exit 1; }
done
rm -f /tmp/mr_err.$$

# --- права на базе с привилегиями по умолчанию Supabase
r=$(q -c "select
  bool_and(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
  from unnest(array['public.points_reconcile_match(uuid)','public.match_rating_check(uuid)','public.match_rating_trg_players()','public.match_rating_trg_matches()','public.match_players_normalize()','public.notify_points_ledger()','public.match_revisions_log_player()','public.points_consistency_run(boolean)']::regprocedure[]) f")
[ "$r" = t ] && ok "0223: внутренние функции недоступны authenticated и anon при умолчаниях Supabase" || bad "0223: внутренние функции доступны приложению ($r)"
r=$(q -c "select has_function_privilege('authenticated', 'public.save_match(uuid,uuid,date,text,integer,integer,jsonb)', 'execute') and has_function_privilege('authenticated', 'public.remove_match_player(uuid,uuid)', 'execute') and has_function_privilege('authenticated', 'public.match_rsvp_restore_marks(uuid)', 'execute') and not has_function_privilege('anon', 'public.save_match(uuid,uuid,date,text,integer,integer,jsonb)', 'execute') and not has_function_privilege('anon', 'public.remove_match_player(uuid,uuid)', 'execute') and not has_function_privilege('anon', 'public.match_rsvp_restore_marks(uuid)', 'execute')")
[ "$r" = t ] && ok "0223: save_match, remove_match_player, match_rsvp_restore_marks: authenticated да, anon нет" || bad "0223: права публичных функций ($r)"
r=$(q -c "select not has_table_privilege('authenticated', 'public.points_ledger', 'insert') and not has_table_privilege('authenticated', 'public.points_ledger', 'update') and not has_table_privilege('authenticated', 'public.points_ledger', 'delete')")
[ "$r" = t ] && ok "0223: журнал баллов закрыт для записи из приложения при умолчаниях Supabase" || bad "0223: журнал баллов открыт для записи ($r)"

# --- прямая запись оценки тренером и родителем при умолчаниях Supabase (права таблицы открыты, решает RLS)
q <<'SQL' >/dev/null
insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c0f1', 'Клуб проверки');
insert into users (id, telegram_id, display_name, is_admin) values ('00000000-0000-0000-0000-0000000000c1', 9980223, 'Тренер', false), ('00000000-0000-0000-0000-0000000000b1', 9980224, 'Родитель', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0f1', 'U10-A');
insert into coach_groups (user_id, group_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1');
insert into players (id, club_id, group_id, full_name, status) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-0000000000e1', 'Игрок', 'active');
insert into matches (id, club_id, played_on, team) values ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000c0f1', '2025-03-10', 'U10');
insert into match_players (match_id, player_id, played, goals, best, performance_rating) values ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000d001', true, 0, true, 3);
SQL
for u in 0000-0000-0000-0000000000c1 0000-0000-0000-0000000000b1; do
  q -c "begin; select set_config('role','authenticated',true), set_config('request.jwt.claims', json_build_object('sub','00000000-$u','role','authenticated')::text, true); update match_players set performance_rating = 5; commit;" >/dev/null
  r=$(q -c "select performance_rating from match_players")
  [ "$r" = 3 ] && ok "0223: прямая запись оценки ($u) не прошла при умолчаниях Supabase" || bad "0223: оценка изменена напрямую ($u): $r"
done

# --- 0224: версия правил от 2026-12-01
OLD='{"played":1,"draw":1,"win":2,"goal":1,"best":2,"cap":5,"technical":0}'
q <<SQL >/dev/null
insert into points_rule_versions (club_id, effective_from, params, comment) values ('00000000-0000-0000-0000-00000000c0f1', date '2026-12-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1), 'match', '$OLD'::jsonb,
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array()), 'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)), 'Стартовая версия');
SQL
st=$(q -f db/ops/preflight.sql | awk -F'|' '$1 == "0224_points_rules_match_rating" {print $3}')
[ "$st" = NOT_APPLIED ] && ok "0224: preflight до применения NOT_APPLIED" || bad "0224: preflight до применения: '$st'"
before=$(q -c "select params - 'match' from points_rule_versions where effective_from = date '2026-12-01'")
q -f db/migrations/0224_points_rules_match_rating.sql >/dev/null 2>&1 && ok "0224 применилась" || bad "0224 не применилась"
r=$(q -c "select params #>> '{match,model}' || ':' || (params #>> '{match,best}') || ':' || (params #>> '{match,cap}') from points_rule_versions where effective_from = date '2026-12-01'")
[ "$r" = "rating:1:6" ] && ok "0224: раздел match на модели оценки (best 1, cap 6)" || bad "0224: раздел match: '$r'"
after=$(q -c "select params - 'match' from points_rule_versions where effective_from = date '2026-12-01'")
[ "$before" = "$after" ] && ok "0224: остальные разделы версии не изменены" || bad "0224: остальные разделы изменились"
r=$(q -c "select count(*) from points_rule_versions where effective_from = date '2026-12-01'")
[ "$r" = 1 ] && ok "0224: вторая версия на ту же дату не создана" || bad "0224: версий на дату: $r"
r=$(q -c "select tgenabled from pg_trigger where tgrelid = 'public.points_rule_versions'::regclass and tgname = 'points_rule_versions_no_change'")
[ "$r" = O ] && ok "0224: защита неизменности версий включена" || bad "0224: защита неизменности: '$r'"
q -c "update points_rule_versions set comment = 'x'" >/dev/null 2>&1 && bad "0224: версию снова можно править" || ok "0224: правка версии по-прежнему запрещена"
r=$(q -c "select (before #>> '{match,best}') || ':' || (after #>> '{match,best}') from audit_log where action = 'points_rules_match_rating'")
[ "$r" = "2:1" ] && ok "0224: before/after записаны в audit_log" || bad "0224: audit_log: '$r'"
st=$(q -f db/ops/preflight.sql | awk -F'|' '$1 == "0224_points_rules_match_rating" {print $3}')
[ "$st" = APPLIED ] && ok "0224: preflight после применения APPLIED" || bad "0224: preflight после применения: '$st'"
q -f db/migrations/0224_points_rules_match_rating.sql >/dev/null 2>&1 && ok "0224: повторный запуск ничего не ломает" || bad "0224: повторный запуск упал"
r=$(q -c "select count(*) from audit_log where action = 'points_rules_match_rating'")
[ "$r" = 1 ] && ok "0224: повторный запуск не пишет второй аудит" || bad "0224: аудитов: $r"

# неожиданное состояние: раздел match отличается от ожидаемого, миграция падает и ничего не меняет
q -c "alter table points_rule_versions disable trigger points_rule_versions_no_change" -c "update points_rule_versions set params = jsonb_set(params, '{match}', '{\"played\":1,\"draw\":1,\"win\":2,\"goal\":1,\"best\":3,\"cap\":5,\"technical\":0}'::jsonb)" -c "alter table points_rule_versions enable trigger points_rule_versions_no_change" >/dev/null
out=$(q -f db/migrations/0224_points_rules_match_rating.sql 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "не совпадает с ожидаемым" && ok "0224: неожиданное состояние: ошибка с понятной причиной" || bad "0224: неожиданное состояние не отклонено: $out"
r=$(q -c "select params #>> '{match,best}' from points_rule_versions where effective_from = date '2026-12-01'")
[ "$r" = 3 ] && ok "0224: при ошибке версия не изменена" || bad "0224: версия изменилась: '$r'"
r=$(q -c "select tgenabled from pg_trigger where tgrelid = 'public.points_rule_versions'::regclass and tgname = 'points_rule_versions_no_change'")
[ "$r" = O ] && ok "0224: при ошибке защита версий включена" || bad "0224: защита после ошибки: '$r'"
$PSQL -q -d postgres -c "drop database if exists $DB"
exit $fail
