#!/usr/bin/env bash
# Собирает миграции от номера FROM до последней в один файл для SQL Editor: одна транзакция, при ошибке не применится ничего.
# Использование: scripts/make-apply-bundle.sh [FROM] > db/ops/apply_all.sql   (FROM по умолчанию 0028)
# Какие миграции уже применены, показывает db/ops/preflight.sql: FROM — первый номер с applied = false.
set -euo pipefail
cd "$(dirname "$0")/.."
FROM="${1:-0028}"
echo "-- Миграции ${FROM}–$(ls db/migrations/*.sql | tail -1 | sed 's#.*/\([0-9]*\)_.*#\1#') одной транзакцией. Сгенерировано scripts/make-apply-bundle.sh ${FROM}."
echo "-- Перед запуском выполните db/ops/preflight.sql: все номера от ${FROM} должны быть applied = false. После: db/ops/postcheck.sql."
echo "begin;"
for f in db/migrations/*.sql; do
  n=$(basename "$f" | cut -c1-4)
  if [[ "$n" < "$FROM" ]]; then continue; fi
  echo; echo "-- ===== $(basename "$f") ====="
  cat "$f"
done
echo; echo "commit;"
