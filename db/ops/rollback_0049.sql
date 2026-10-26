-- Ручной откат миграции 0049 (U12 -> Ortachala U12), Issue #172. Выполнять вручную, по шагам; ничего не запускается автоматически.
-- До 0049 матчей с командой «Ortachala U12» в базе не было, поэтому переименованный матч — единственный.

-- Шаг 1 (только чтение): найти матч. Ожидается 1 строка (матч Newton cup, 2026-06-14). Сохранить id.
select id, club_id, played_on, team, opponent
from matches
where team = 'Ortachala U12';

-- Шаг 2 (запись): вернуть старое название. Подставить id из шага 1. Если строк было больше одной, откатывать только матч 2026-06-14.
-- update matches set team = 'U12'
-- where id = '<id из шага 1>' and team = 'Ortachala U12';

-- Шаг 3 (только чтение): проверка. После отката: U12 = 1, Ortachala U12 нет; без отката наоборот.
select team, count(*) from matches group by team order by 2 desc;
