#!/usr/bin/env bash
# Проверка восстановления дампа (REL-01). Восстанавливает ТОЛЬКО в локальный PostgreSQL, не в Supabase.
# Условия приёмки: db/ops/BACKUP_ACCEPTANCE.md. Инструкция: db/ops/BACKUP.md.
#
# Использование: db/ops/backup-restore-check.sh <kickstart-ГГГГ-ММ-ДД_ЧЧММ.dump[.age]>
# Рядом должен лежать manifest (.manifest или .manifest.age) из backup-pg-dump.sh.
#
# Переменные:
#   TEST_PG_URL      локальный сервер БЕЗ имени базы, например postgresql://postgres@localhost:5432
#                    Адреса Supabase отвергаются.
#   AGE_IDENTITY     файл с приватным ключом age, нужен для .age. Хранить вне репозитория.
#   KEEP_RESTORE_DB=1  не удалять восстановленную базу kickstart_restore_check после проверки.
#   PG_BIN           каталог с psql и pg_restore, если их нет в PATH.
#
# Код выхода: 0 — всё совпало; 1 — ошибка восстановления или расхождение счётчиков; 2 — неверный запуск.
set -euo pipefail

die() { echo "ОШИБКА: $*" >&2; exit 2; }
fail() { echo "НЕ ПРОЙДЕНО: $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DB=kickstart_restore_check

pgtool() { if [ -n "${PG_BIN:-}" ]; then echo "$PG_BIN/$1"; else echo "$1"; fi; }
PSQL="$(pgtool psql)"; PG_RESTORE="$(pgtool pg_restore)"

hash_file() {
  local d b; d="$(dirname "$1")"; b="$(basename "$1")"
  if command -v sha256sum >/dev/null 2>&1; then (cd "$d" && sha256sum "$b"); else (cd "$d" && shasum -a 256 "$b"); fi
}

src="${1:-}"
[ -n "$src" ] && [ -f "$src" ] || die "укажите файл дампа: backup-restore-check.sh <файл.dump[.age]>"
[ -n "${TEST_PG_URL:-}" ] || die "TEST_PG_URL не задан (локальный PostgreSQL, например postgresql://postgres@localhost:5432)"
case "$TEST_PG_URL" in
  *supabase*|*pooler*) die "TEST_PG_URL указывает на Supabase. Проверка восстановления идёт только в локальной базе";;
esac
local_re='^postgres(ql)?://([^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$'
[[ "$TEST_PG_URL" =~ $local_re ]] || die "TEST_PG_URL должен указывать на localhost без имени базы"
command -v "$PSQL" >/dev/null 2>&1 || die "нет psql"
command -v "$PG_RESTORE" >/dev/null 2>&1 || die "нет pg_restore (версия должна быть не ниже версии дампа)"

work="$(mktemp -d "${TMPDIR:-/tmp}/kickstart-restore.XXXXXX")"
chmod 700 "$work"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
started=$(date +%s)

# ---- 1. Расшифровка и поиск manifest ----
dir="$(cd "$(dirname "$src")" && pwd)"
name="$(basename "$src")"
stem="${name%.dump.age}"; stem="${stem%.dump}"
dump="$src"
if [ "${name%.age}" != "$name" ]; then
  [ -n "${AGE_IDENTITY:-}" ] || die "для .age нужен AGE_IDENTITY (файл с приватным ключом age)"
  command -v age >/dev/null 2>&1 || die "нет age"
  dump="$work/$stem.dump"
  age -d -i "$AGE_IDENTITY" -o "$dump" "$src" 2>/dev/null || fail "$name не расшифровывается этим ключом (AGE_IDENTITY) или повреждён"
  [ -f "$dir/$stem.manifest.age" ] || fail "нет $stem.manifest.age рядом с дампом"
  age -d -i "$AGE_IDENTITY" -o "$work/$stem.manifest" "$dir/$stem.manifest.age" 2>/dev/null \
    || fail "manifest не расшифровывается этим ключом или повреждён"
  mf="$work/$stem.manifest"
else
  mf="$dir/$stem.manifest"
fi
[ -f "$mf" ] || fail "нет manifest для $name"

# ---- 2. Целостность и читаемость ----
expected_sha="$(grep '^# sha256:' "$mf" | awk '{print $3}')"
[ -n "$expected_sha" ] || fail "в manifest нет строки sha256"
actual_sha="$(hash_file "$dump" | awk '{print $1}')"
[ "$expected_sha" = "$actual_sha" ] || fail "контрольная сумма дампа не совпадает с manifest"
echo "ok - sha256 совпадает с manifest"
"$PG_RESTORE" -l "$dump" >/dev/null || fail "pg_restore -l не читает дамп"
echo "ok - оглавление дампа читается"

# ---- 3. Восстановление в локальную базу ----
"$PSQL" "$TEST_PG_URL/postgres" -X -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists $DB" -c "create database $DB"
# Роли, которые Supabase создаёт сама. Без них GRANT из дампа падает.
"$PSQL" "$TEST_PG_URL/$DB" -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
-- Схема public, которую создаёт сама база, мешает CREATE SCHEMA из дампа. База проверочная: убираем, дамп создаст свою.
drop schema public cascade;
SQL

log="$work/restore.log"
set +e
"$PG_RESTORE" --no-owner --dbname="$TEST_PG_URL/$DB" --verbose "$dump" >"$work/restore.out" 2>"$log"
rc=$?
set -e
errors="$(grep -c 'error:' "$log" || true)"
if [ "$rc" -ne 0 ] || [ "$errors" -ne 0 ]; then
  echo "--- первые ошибки восстановления ($errors):" >&2
  grep 'error:' "$log" | head -20 >&2 || true
  fail "pg_restore: код $rc, ошибок $errors"
fi
echo "ok - pg_restore без ошибок"

# ---- 4. Сверка счётчиков строк с manifest ----
"$PSQL" "$TEST_PG_URL/$DB" -X -Atq -f "$SCRIPT_DIR/backup-manifest-counts.sql" | sort > "$work/restored.counts"
grep -v '^#' "$mf" | grep '|' | sort > "$work/expected.counts"
if ! diff "$work/expected.counts" "$work/restored.counts" > "$work/diff.txt"; then
  cat "$work/diff.txt" >&2
  fail "счётчики строк не совпадают с manifest (строки «<» из manifest, «>» после восстановления)"
fi
echo "ok - счётчики строк совпадают по $(wc -l < "$work/expected.counts" | tr -d ' ') таблицам"

# ---- 5. Тот же preflight, что владелец запускает на боевой базе ----
pf="$("$PSQL" "$TEST_PG_URL/$DB" -X -Atq -v ON_ERROR_STOP=1 -f "$REPO_ROOT/db/ops/preflight.sql")" \
  || fail "preflight.sql не выполняется на восстановленной базе"
# 0047 и 0052 показываются как f даже на полной базе (их признаки перекрыты поздними миграциями, см. scripts/run-db-tests.sh).
not_applied="$(echo "$pf" | grep '|f$' | grep -vE '^(0047_ind_no_autobook|0052_ind_change_type)\|f$' || true)"
echo "ok - preflight.sql выполняется; миграций со статусом «не применена» в дампе: $(echo -n "$not_applied" | grep -c '' || true)"
if [ -n "$not_applied" ]; then echo "$not_applied" | sed 's/^/   не применено: /'; fi

elapsed=$(( $(date +%s) - started ))
echo "время проверки: ${elapsed} с (для RTO: восстановление на боевом объёме займёт больше, см. db/ops/BACKUP.md)"

if [ "${KEEP_RESTORE_DB:-0}" != 1 ]; then
  "$PSQL" "$TEST_PG_URL/postgres" -X -q -c "drop database if exists $DB" >/dev/null
  echo "ok - тестовая база $DB удалена (KEEP_RESTORE_DB=1 оставит её)"
fi
echo "ПРОЙДЕНО: $name"
