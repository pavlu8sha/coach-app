-- Переименование турнира «Newton cup 2014-2015» → «Newton Cup» (команда U12).
-- Выполнять в Supabase SQL Editor по шагам. Сначала шаг 1 (только чтение).

-- Шаг 1 (только чтение): должна быть ровно 1 строка.
select id, team, kind, name, starts_on
from tournaments
where team = 'U12' and name = 'Newton cup 2014-2015';

-- Шаг 2 (запись): выполнять только если шаг 1 вернул 1 строку.
begin;
update tournaments
set name = 'Newton Cup'
where team = 'U12' and name = 'Newton cup 2014-2015'
returning id, name;
-- Если вернулась 1 строка — commit; если 0 или больше одной — rollback.
commit;
-- rollback;

-- Шаг 3 (только чтение): проверка.
select id, team, name from tournaments where team = 'U12';
