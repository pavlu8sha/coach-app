-- #473, дополнение: проставить сумму исторических оплат дополнительных тренировок. Запускает только Павел в SQL Editor.
-- Решение Павла 09.11: все эти тренировки стоили 15 ₾, кроме занятия 11.10.2026 (35-я школа); у оплат осталась сумма 0.00 (метка из старого импорта).
-- Что меняется: extra_bookings.paid_amount для записей paid = true, у которых сумма пустая или 0, на занятиях до 01.11.2026 (кроме 11.10).
-- Что НЕ меняется: paid, способ оплаты (method остаётся пустым: способ неизвестен), даты, отметки посещаемости, журнал service_payments, записи с уже заполненной суммой.
-- Зачем: сейчас долг по занятию считается как «сумма занятия минус paid_amount», и с paid_amount = 0.00 такая оплата выглядит неоплаченной на 15 ₾.
-- Защита: скрипт остановится с ошибкой и ничего не изменит, если у какого-то из этих занятий сумма занятия (extra_sessions.amount) не равна 15.
-- Идемпотентно: повторный запуск вернёт 0 строк. Не зависит от backfill посещаемости, их можно запускать в любом порядке.
-- Результат (список с прежней и новой суммой) сохраните в CSV и пришлите: это журнал аудита.

do $$
declare n int;
begin
  select count(*) into n
    from extra_bookings b
    join extra_sessions e on e.id = b.session_id
   where b.paid and coalesce(b.paid_amount, 0) = 0
     and e.cancelled_at is null
     and e.starts_on < date '2026-11-01'
     and e.starts_on <> date '2026-10-11'
     and e.amount <> 15;
  if n > 0 then
    raise exception 'у % записей сумма занятия не 15, остановка', n;
  end if;
end $$;

with t as (
  select b.session_id, b.player_id, e.starts_on, b.paid_amount as old_amount
    from extra_bookings b
    join extra_sessions e on e.id = b.session_id
   where b.paid and coalesce(b.paid_amount, 0) = 0
     and e.cancelled_at is null
     and e.starts_on < date '2026-11-01'
     and e.starts_on <> date '2026-10-11'
     and e.amount = 15
), upd as (
  update extra_bookings b
     set paid_amount = 15
    from t
   where b.session_id = t.session_id and b.player_id = t.player_id
  returning b.session_id, b.player_id
)
select t.starts_on as "дата", t.session_id as "id занятия", t.player_id, t.old_amount as "было", 15 as "стало", now() as "когда"
  from t join upd using (session_id, player_id)
 order by t.starts_on, t.player_id;

-- Проверка после записи (оплаченных с суммой 0 или пустой на этих занятиях должно остаться 0):
-- select count(*) from extra_bookings b join extra_sessions e on e.id = b.session_id
--  where b.paid and coalesce(b.paid_amount, 0) = 0 and e.starts_on < date '2026-11-01';

-- Отмена (вернёт 0.00 только для записей из журнала аудита выше, подставьте их список в in (...)):
-- update extra_bookings set paid_amount = 0 where (session_id, player_id) in (('<id занятия>'::uuid, '<player_id>'::uuid));
