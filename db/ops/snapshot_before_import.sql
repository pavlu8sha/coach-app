-- Копия таблиц, которые трогает импорт, ПЕРЕД записью (сб 31.10). Выполнить в Supabase → SQL Editor один раз, до первого запуска с --write.
-- Копии лежат в отдельной схеме snap_20261031: она не входит в API (PostgREST отдаёт только public), поэтому данные детей через неё не доступны.
-- Ничего не удаляет и не меняет в рабочих таблицах. Схему удалить через 2–3 недели после перехода: drop schema snap_20261031 cascade;
create schema if not exists snap_20261031;
do $$
declare t text;
begin
  foreach t in array array[
    'groups', 'players', 'weekly_schedule', 'training_log', 'sessions', 'attendance', 'rules', 'point_events',
    'tournaments', 'matches', 'match_players', 'match_fees', 'tournament_fees', 'match_staff',
    'subscriptions', 'payments', 'individual_sessions', 'individual_bookings', 'extra_sessions', 'extra_bookings',
    'equipment_catalog', 'equipment_orders', 'equipment_order_lines', 'equipment_issues',
    'camps', 'camp_tariffs', 'camp_participants', 'camp_payments', 'club_settings'
  ] loop
    execute format('create table snap_20261031.%I as table public.%I', t, t);
  end loop;
end $$;

-- Проверка: число строк в копии и в рабочей таблице должно совпасть (запустить сразу после копии).
select t.table_name as таблица,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from snap_20261031.%I', t.table_name), false, true, '')))[1]::text::int as в_копии,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text::int as в_базе
from information_schema.tables t
where t.table_schema = 'snap_20261031'
order by 1;
