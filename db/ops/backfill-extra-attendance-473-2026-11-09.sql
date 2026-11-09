-- #473, этап 2: отметка «Был» для исторических дополнительных тренировок. Запускает только Павел в SQL Editor.
-- Объём (по readonly-проверке от 09.11): 24 занятия с 18.01 по 17.10.2026, 360 записей с «оплачено» + 1 запись без оплаты, подтверждённая владельцем (итого 361).
--   * основание «оплата»: extra_bookings.paid = true и отметки ещё нет;
--   * основание «подтверждено владельцем» (Павел, 09.11): занятие 17.10.2026 (7a610517-a782-4031-a948-22cc036eedaf), игрок 6dd7c3de-bb97-43fb-8fd9-b33818b8bfa8.
-- Меняется только extra_bookings.attended (null -> true). Оплаты, суммы, способы, даты и другие таблицы не трогаются.
-- Баллы не начисляются: до points_start (2026-11-01) правила баллов не действуют, все занятия раньше.
-- Уведомлений родителям нет: на обновление extra_bookings висит только триггер баллов (0121).
-- Идемпотентно: обновляются только записи без отметки. Повторный запуск вернёт 0 строк.
-- Один запуск = одна транзакция: если число записей не 361 (и не 0), скрипт останавливается с ошибкой и ничего не меняет.
-- Результат (список обновлённых записей) сохраните в CSV и пришлите: это журнал аудита (что отмечено, на каком основании, когда).

do $$
declare n int;
begin
  select count(*) into n
    from extra_bookings b
    join extra_sessions e on e.id = b.session_id
   where b.attended is null
     and e.cancelled_at is null
     and e.starts_on < date '2026-11-01'
     and (b.paid or (b.session_id = '7a610517-a782-4031-a948-22cc036eedaf'::uuid and b.player_id = '6dd7c3de-bb97-43fb-8fd9-b33818b8bfa8'::uuid));
  if n not in (0, 361) then
    raise exception 'ожидалось 361 запись (или 0 при повторном запуске), найдено %', n;
  end if;
end $$;

with upd as (
  update extra_bookings b
     set attended = true
    from extra_sessions e
   where e.id = b.session_id
     and b.attended is null
     and e.cancelled_at is null
     and e.starts_on < date '2026-11-01'
     and (b.paid or (b.session_id = '7a610517-a782-4031-a948-22cc036eedaf'::uuid and b.player_id = '6dd7c3de-bb97-43fb-8fd9-b33818b8bfa8'::uuid))
  returning b.session_id, b.player_id, e.starts_on, b.paid
)
select starts_on as "дата", session_id as "id занятия", player_id,
       case when paid then 'оплата' else 'подтверждено владельцем' end as "основание",
       now() as "когда"
  from upd
 order by starts_on, player_id;

-- Проверка после записи (должно быть: 24 занятия, 361 «Был», 0 без отметки среди оплаченных):
-- select count(*) filter (where attended is true) as "был", count(*) filter (where attended is null) as "без отметки", count(distinct session_id) as "занятий"
--   from extra_bookings b join extra_sessions e on e.id = b.session_id where e.starts_on < date '2026-11-01';

-- Отмена (только пока тренеры не вносили отметки на эти занятия: до записи отметок на них не было вообще):
-- update extra_bookings b set attended = null from extra_sessions e
--  where e.id = b.session_id and e.starts_on between date '2026-01-18' and date '2026-10-17' and b.attended is true;
