# Защита тестовых скриптов от запуска на удалённой базе (#471 PR-0, условие Б9).
# run-db-tests.sh удаляет и пересоздаёт базу и применяет все миграции: это допустимо только на локальном сервере.
# Разрешено: unix-сокет (путь, начинающийся с /), localhost, 127.0.0.1, ::1 или хост не задан.
# Проверяются PGHOST, PGHOSTADDR, PGSERVICE, PGDATABASE как строка подключения и параметры в $PSQL (-h, --host=, host=, postgres:// URL).
# Использование: . scripts/lib/local-db-guard.sh; local_db_guard "$PSQL" || exit 2
local_db_host_ok() {
  case "$1" in
    ''|/*|localhost|127.0.0.1|::1) return 0 ;;
    *) return 1 ;;
  esac
}
local_db_guard() {
  psql_cmd="$1"
  for h in "${PGHOST:-}" "${PGHOSTADDR:-}"; do
    local_db_host_ok "$h" || { echo "Отказ: PGHOST/PGHOSTADDR=$h — тесты базы запускаются только на локальном сервере" >&2; return 1; }
  done
  if [ -n "${PGSERVICE:-}" ]; then echo "Отказ: PGSERVICE задан ($PGSERVICE) — хост не проверить, тесты базы только на локальном сервере" >&2; return 1; fi
  case "${PGDATABASE:-}" in *=*|*://*) echo "Отказ: PGDATABASE содержит строку подключения" >&2; return 1 ;; esac
  # -h ХОСТ, -hХОСТ, --host ХОСТ, --host=ХОСТ
  set -f
  # shellcheck disable=SC2086
  set -- $psql_cmd
  set +f
  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--host) shift; local_db_host_ok "${1:-}" || { echo "Отказ: хост ${1:-} в PSQL — тесты базы только на локальном сервере" >&2; return 1; } ;;
      --host=*) local_db_host_ok "${1#--host=}" || { echo "Отказ: хост ${1#--host=} в PSQL — тесты базы только на локальном сервере" >&2; return 1; } ;;
      *://*|*host=*|*hostaddr=*|*service=*) echo "Отказ: в PSQL строка подключения ($1) — тесты базы только на локальном сервере" >&2; return 1 ;;
      -h?*) local_db_host_ok "${1#-h}" || { echo "Отказ: хост ${1#-h} в PSQL — тесты базы только на локальном сервере" >&2; return 1; } ;;
    esac
    shift
  done
  return 0
}
