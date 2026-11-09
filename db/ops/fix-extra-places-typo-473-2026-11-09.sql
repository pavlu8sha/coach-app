-- #473, поправка к fix-extra-places-473-2026-11-09.sql: опечатка в названии места, «Чиовани» -> «Чиковани» (уточнение Павла 09.11).
-- Запускает только Павел в SQL Editor. Меняется только extra_sessions.place у занятий с местом ровно «Чиовани» (ожидается 16, с 18.01 по 07.06.2026).
-- Защита: один запуск = одна транзакция; если таких занятий не 16 (и не 0 при повторном запуске), ошибка и никаких изменений.
-- Идемпотентно: повторный запуск вернёт 0 строк. Результат сохраните в CSV и пришлите: журнал аудита.

do $$
declare n int;
begin
  select count(*) into n from extra_sessions where place = 'Чиовани';
  if n not in (0, 16) then
    raise exception 'ожидалось 16 занятий с местом «Чиовани» (или 0 при повторном запуске), найдено %', n;
  end if;
end $$;

with upd as (
  update extra_sessions set place = 'Чиковани'
   where place = 'Чиовани'
  returning id, starts_on, place
)
select starts_on as "дата", id as "id занятия", 'Чиовани' as "было", place as "стало", now() as "когда"
  from upd order by starts_on;

-- Проверка после записи (должно быть 0 с «Чиовани» и 16 с «Чиковани»):
-- select place, count(*) from extra_sessions where place in ('Чиовани', 'Чиковани') group by place;

-- Отмена: update extra_sessions set place = 'Чиовани' where id in (<id занятий из журнала аудита>);
