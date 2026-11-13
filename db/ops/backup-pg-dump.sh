#!/usr/bin/env bash
# Логический дамп боевой БД Supabase (REL-01). Только чтение: pg_dump и select, ничего не меняет.
# Условия приёмки: db/ops/BACKUP_ACCEPTANCE.md. Инструкция: db/ops/BACKUP.md.
#
# Переменные (их можно положить в файл BACKUP_ENV_FILE, по умолчанию ~/.config/kickstart/backup.env, права 600):
#   SUPABASE_DB_URL  строка подключения: Supabase → Connect → Session pooler, порт 5432. Не коммитить, не присылать в чат.
#   AGE_RECIPIENT    публичный ключ age (age1...). Обязателен всегда: незашифрованная копия не пишется ни при каких настройках.
#   BACKUP_DIR       каталог копий, по умолчанию ~/kickstart-backups. Внутри репозитория запрещён.
#   BACKUP_KIND      daily (по умолчанию: ротация 14 дней, воскресенье дублируется в weekly/)
#                    или premigration (перед миграцией: папка premigration/, без ротации).
#   KEEP_DAILY       сколько дней хранить daily, по умолчанию 14.
#   KEEP_WEEKLY      сколько недель хранить weekly, по умолчанию 8.
#   PG_BIN           каталог с pg_dump, psql, pg_restore, если их нет в PATH.
set -euo pipefail

die() { echo "ОШИБКА: $*" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ENV_FILE="${BACKUP_ENV_FILE:-$HOME/.config/kickstart/backup.env}"
if [ -f "$ENV_FILE" ]; then
  mode="$(stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE")"
  case "$mode" in 600|400) ;; *) die "файл $ENV_FILE должен иметь права 600 (chmod 600 $ENV_FILE)";; esac
  set -a; . "$ENV_FILE"; set +a
fi

pgtool() { if [ -n "${PG_BIN:-}" ]; then echo "$PG_BIN/$1"; else echo "$1"; fi; }
PG_DUMP="$(pgtool pg_dump)"; PSQL="$(pgtool psql)"; PG_RESTORE="$(pgtool pg_restore)"

hash_file() {  # hash_file <путь>: печатает «<sha256>  <имя файла>»
  local d b; d="$(dirname "$1")"; b="$(basename "$1")"
  if command -v sha256sum >/dev/null 2>&1; then (cd "$d" && sha256sum "$b"); else (cd "$d" && shasum -a 256 "$b"); fi
}

# ---- 1. Проверки до подключения к базе ----
# Шифрование обязательно. Отключить его нечем: открытый дамп существует только во временной папке
# с правами 700 и удаляется при любом завершении скрипта.
if [ -n "${ALLOW_PLAIN+x}" ]; then
  die "ALLOW_PLAIN не поддерживается: копия всегда шифруется. Уберите ALLOW_PLAIN из окружения и backup.env"
fi
[ -n "${AGE_RECIPIENT:-}" ] || die "AGE_RECIPIENT не задан: копия не пишется без шифрования (см. db/ops/BACKUP.md, раздел «Настройка»)"
[[ "$AGE_RECIPIENT" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || die "AGE_RECIPIENT не похож на публичный ключ age (age1 и 58 символов)"
command -v age >/dev/null 2>&1 || die "нет age (установите пакет age)"
[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL не задан (см. db/ops/BACKUP.md, раздел «Настройка»)"
command -v "$PG_DUMP" >/dev/null 2>&1 || die "нет pg_dump (установите клиент PostgreSQL или задайте PG_BIN)"
command -v "$PSQL" >/dev/null 2>&1 || die "нет psql"
command -v "$PG_RESTORE" >/dev/null 2>&1 || die "нет pg_restore"

BACKUP_KIND="${BACKUP_KIND:-daily}"
case "$BACKUP_KIND" in daily|premigration) ;; *) die "BACKUP_KIND: daily или premigration";; esac
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"

BACKUP_DIR="${BACKUP_DIR:-$HOME/kickstart-backups}"
case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$PWD/$BACKUP_DIR";; esac
case "$BACKUP_DIR/" in "$REPO_ROOT/"*) die "BACKUP_DIR внутри репозитория ($BACKUP_DIR). Выберите папку вне git-копии";; esac
mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd -P)"
case "$BACKUP_DIR/" in "$REPO_ROOT/"*) die "BACKUP_DIR внутри репозитория ($BACKUP_DIR). Выберите папку вне git-копии";; esac

# ---- 2. Версии: pg_dump не может быть старше сервера ----
client_major="$("$PG_DUMP" --version | grep -oE '[0-9]+' | head -1)"
server_num="$("$PSQL" "$SUPABASE_DB_URL" -X -Atq -c 'show server_version_num')" \
  || die "нет подключения к БД (проверьте SUPABASE_DB_URL и сеть)"
server_major=$((server_num / 10000))
if [ "$client_major" -lt "$server_major" ]; then
  die "pg_dump $client_major старше сервера $server_major: установите клиент PostgreSQL $server_major или новее"
fi

# ---- 3. Дамп в приватную временную папку (вне BACKUP_DIR) ----
ts="$(date +%Y-%m-%d_%H%M)"
case "$BACKUP_KIND" in premigration) sub=premigration;; *) sub=daily;; esac
dest_dir="$BACKUP_DIR/$sub"
mkdir -p "$dest_dir"
base="$dest_dir/kickstart-$ts"
name="kickstart-$ts"
[ ! -e "$base.dump.age" ] || die "файл уже существует: $base.dump.age (подождите минуту и запустите снова)"

umask 077
work="$(mktemp -d "${TMPDIR:-/tmp}/kickstart-dump.XXXXXX")"
chmod 700 "$work"
cleanup() {
  rm -rf -- "$work"
  rm -f -- "$base.dump.age.partial" "$base.manifest.age.partial"
}
trap cleanup EXIT
plain="$work/$name.dump"

echo "pg_dump: схемы public, auth, storage, cron, snap_* → $base.dump.age"
"$PG_DUMP" "$SUPABASE_DB_URL" --format=custom --no-owner --compress=6 --lock-wait-timeout=15000 \
  -n public -n auth -n storage -n cron -n 'snap_*' -f "$plain" \
  || die "pg_dump завершился с ошибкой; копия не записана"
"$PG_RESTORE" -l "$plain" >/dev/null || die "pg_restore -l не читает дамп; копия не записана"
[ -s "$plain" ] || die "дамп пустой"

# ---- 4. Контрольная сумма и manifest (число строк по таблицам public) ----
sha_line="$(hash_file "$plain")"
sha="${sha_line%% *}"
{
  echo "# kickstart backup manifest"
  echo "# created: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# kind: $BACKUP_KIND"
  echo "# server_major: $server_major"
  echo "# dump: $name.dump"
  echo "# sha256: $sha"
  "$PSQL" "$SUPABASE_DB_URL" -X -Atq -f "$SCRIPT_DIR/backup-manifest-counts.sql" \
    || die "не сняты счётчики строк для manifest"
} > "$work/$name.manifest"

# ---- 5. Шифрование (age): в BACKUP_DIR попадают только зашифрованные файлы ----
is_age() { [ -s "$1" ] && [ "$(head -c 21 "$1")" = "age-encryption.org/v1" ]; }
age -r "$AGE_RECIPIENT" -o "$base.dump.age.partial" "$plain" || die "age не зашифровал дамп; копия не записана"
age -r "$AGE_RECIPIENT" -o "$base.manifest.age.partial" "$work/$name.manifest" || die "age не зашифровал manifest; копия не записана"
is_age "$base.dump.age.partial" || die "зашифрованный дамп не в формате age; копия не записана"
is_age "$base.manifest.age.partial" || die "зашифрованный manifest не в формате age; копия не записана"
mv "$base.manifest.age.partial" "$base.manifest.age"
mv "$base.dump.age.partial" "$base.dump.age"
final="$base.dump.age"

# ---- 6. Ротация ----
if [ "$BACKUP_KIND" = daily ]; then
  find "$dest_dir" -maxdepth 1 -type f -name 'kickstart-*' -mtime +"$KEEP_DAILY" -print -delete
  if [ "$(date +%u)" = 7 ]; then
    mkdir -p "$BACKUP_DIR/weekly"
    for f in "$base".*; do cp -p "$f" "$BACKUP_DIR/weekly/"; done
    echo "воскресная копия: $BACKUP_DIR/weekly/"
    find "$BACKUP_DIR/weekly" -maxdepth 1 -type f -name 'kickstart-*' -mtime +$((KEEP_WEEKLY * 7)) -print -delete
  fi
fi

echo "OK: $final"
echo "sha256 (открытого дампа): $sha"
echo "Проверка восстановления: db/ops/backup-restore-check.sh \"$final\""
