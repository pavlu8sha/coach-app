-- Только чтение: число строк в каждой таблице схемы public.
-- Нужен для manifest дампа (backup-pg-dump.sh) и для сверки после восстановления (backup-restore-check.sh).
-- Запуск: psql -Atq -f db/ops/backup-manifest-counts.sql "<строка подключения>"
-- Формат строки: имя_таблицы|число_строк
select table_name || '|' || (xpath('/row/c/text()',
         query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name;
