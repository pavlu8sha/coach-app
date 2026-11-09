-- #473, места проведения исторических дополнительных тренировок. Запускает только Павел в SQL Editor.
-- Список от Павла 09.11 (все даты 2026 года): 22 занятия, у которых место пустое.
--   Чиовани (16): 18.01, 25.01, 08.02, 15.02, 22.02, 08.03, 15.03, 22.03, 29.03, 19.04, 03.05, 10.05, 17.05, 24.05, 31.05, 07.06
--   Исани (4): 13.06, 19.09, 26.09, 03.10
--   Красный парк (2): 20.06, 27.06
-- Меняется только extra_sessions.place, и только там, где оно сейчас пустое. Занятия 11.10 («35-я школа») и 17.10 («Исани») не трогаются.
-- Защита: один запуск = одна транзакция. Ожидается ровно 22 занятия с пустым местом до 01.11.2026, и все они должны попасть в список; иначе ошибка и никаких изменений.
-- Идемпотентно: повторный запуск вернёт 0 строк.
-- Результат (дата, id занятия, было, стало, когда) сохраните в CSV и пришлите: это журнал аудита.

do $$
declare empty_n int; matched int;
begin
  select count(*) into empty_n from extra_sessions
   where place is null and cancelled_at is null and starts_on < date '2026-11-01';
  select count(*) into matched from extra_sessions e
    join (values
      (date '2026-01-18'), (date '2026-01-25'), (date '2026-02-08'), (date '2026-02-15'), (date '2026-02-22'),
      (date '2026-03-08'), (date '2026-03-15'), (date '2026-03-22'), (date '2026-03-29'), (date '2026-04-19'),
      (date '2026-05-03'), (date '2026-05-10'), (date '2026-05-17'), (date '2026-05-24'), (date '2026-05-31'),
      (date '2026-06-07'), (date '2026-06-13'), (date '2026-09-19'), (date '2026-09-26'), (date '2026-10-03'),
      (date '2026-06-20'), (date '2026-06-27')
    ) as v(d) on v.d = e.starts_on
   where e.place is null and e.cancelled_at is null;
  if not ((empty_n = 22 and matched = 22) or (empty_n = 0 and matched = 0)) then
    raise exception 'ожидалось 22 занятия с пустым местом и все из списка (или 0 при повторном запуске), найдено % и %', empty_n, matched;
  end if;
end $$;

with v(d, place) as (values
  (date '2026-01-18', 'Чиовани'), (date '2026-01-25', 'Чиовани'), (date '2026-02-08', 'Чиовани'), (date '2026-02-15', 'Чиовани'),
  (date '2026-02-22', 'Чиовани'), (date '2026-03-08', 'Чиовани'), (date '2026-03-15', 'Чиовани'), (date '2026-03-22', 'Чиовани'),
  (date '2026-03-29', 'Чиовани'), (date '2026-04-19', 'Чиовани'), (date '2026-05-03', 'Чиовани'), (date '2026-05-10', 'Чиовани'),
  (date '2026-05-17', 'Чиовани'), (date '2026-05-24', 'Чиовани'), (date '2026-05-31', 'Чиовани'), (date '2026-06-07', 'Чиовани'),
  (date '2026-06-13', 'Исани'), (date '2026-09-19', 'Исани'), (date '2026-09-26', 'Исани'), (date '2026-10-03', 'Исани'),
  (date '2026-06-20', 'Красный парк'), (date '2026-06-27', 'Красный парк')
), upd as (
  update extra_sessions e set place = v.place
    from v
   where v.d = e.starts_on and e.place is null and e.cancelled_at is null
  returning e.id, e.starts_on, e.place
)
select starts_on as "дата", id as "id занятия", null::text as "было", place as "стало", now() as "когда"
  from upd order by starts_on;

-- Проверка после записи (пустых мест до 01.11 не должно остаться):
-- select starts_on, place, id from extra_sessions where starts_on < date '2026-11-01' and cancelled_at is null order by starts_on;

-- Отмена: update extra_sessions set place = null where id in (<id занятий из журнала аудита>);
