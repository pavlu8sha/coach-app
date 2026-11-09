-- #473, дополнение (версия 2 после разбора сумм): проставить 15 ₾ историческим дополнительным тренировкам и их оплатам. Запускает только Павел в SQL Editor.
-- Факты из read-only проверки 09.11: 21 занятие с 18.01 по 26.09.2026 записаны в базе с суммой занятия 0.00 (места нет), у 317 их оплат сумма 0.00.
-- Решение Павла 09.11: все эти тренировки стоили по 15 ₾. Занятия 03.10 (15, без нулей), 11.10 (20, 35-я школа) и 17.10 (15, Исани) уже заполнены и не затрагиваются.
-- Что меняется:
--   1) extra_sessions.amount: 0.00 -> 15.00 у этих 21 занятия;
--   2) extra_bookings.paid_amount: 0.00 -> 15.00 у 317 оплат на этих занятиях (оплаты с уже проставленными 15.00 не трогаются).
-- Что НЕ меняется: paid, способ оплаты (у старых оплат он пуст и остаётся пустым), даты, отметки посещаемости, журнал service_payments, места, остальные занятия.
-- Долгов не появится: на этих 21 занятии нет ни одной неоплаченной записи (скрипт это проверяет и останавливается, если иначе).
-- Защита: один запуск = одна транзакция. Ожидается ровно 21 занятие и 317 оплат (или 0 и 0 при повторном запуске), иначе ошибка и никаких изменений.
-- Результат (список изменений с прежним и новым значением) сохраните в CSV и пришлите: это журнал аудита.

do $$
declare s int; n int; unpaid int;
begin
  select count(*) into s from extra_sessions e
   where e.amount = 0 and e.cancelled_at is null and e.starts_on < date '2026-11-01';
  select count(*) into n from extra_bookings b join extra_sessions e on e.id = b.session_id
   where e.amount = 0 and e.cancelled_at is null and e.starts_on < date '2026-11-01'
     and b.paid and coalesce(b.paid_amount, 0) = 0;
  select count(*) into unpaid from extra_bookings b join extra_sessions e on e.id = b.session_id
   where e.amount = 0 and e.cancelled_at is null and e.starts_on < date '2026-11-01' and not b.paid;
  if unpaid > 0 then
    raise exception 'на занятиях с суммой 0 есть неоплаченные записи (%), остановка', unpaid;
  end if;
  if not ((s = 21 and n = 317) or (s = 0 and n = 0)) then
    raise exception 'ожидалось 21 занятие и 317 оплат (или 0 и 0), найдено % и %', s, n;
  end if;
end $$;

with tgt as (
  select e.id from extra_sessions e
   where e.amount = 0 and e.cancelled_at is null and e.starts_on < date '2026-11-01'
), pay as (
  select b.session_id, b.player_id, b.paid_amount as old_amount
    from extra_bookings b join tgt on tgt.id = b.session_id
   where b.paid and coalesce(b.paid_amount, 0) = 0
), upd_pay as (
  update extra_bookings b set paid_amount = 15
    from pay where b.session_id = pay.session_id and b.player_id = pay.player_id
  returning b.session_id, b.player_id
), upd_ses as (
  update extra_sessions e set amount = 15
    from tgt where e.id = tgt.id
  returning e.id, e.starts_on
)
select 'занятие' as "что", u.starts_on as "дата", u.id as "id занятия", null::uuid as player_id, 0::numeric as "было", 15 as "стало", now() as "когда"
  from upd_ses u
union all
select 'оплата', e.starts_on, p.session_id, p.player_id, coalesce(pay.old_amount, 0), 15, now()
  from upd_pay p
  join pay on pay.session_id = p.session_id and pay.player_id = p.player_id
  join extra_sessions e on e.id = p.session_id
order by 2, 1, 4;

-- Проверка после записи (занятий с суммой 0 и оплат с суммой 0 до 01.11 не должно остаться):
-- select (select count(*) from extra_sessions where amount = 0 and starts_on < date '2026-11-01') as "занятий с нулём",
--        (select count(*) from extra_bookings b join extra_sessions e on e.id = b.session_id where b.paid and coalesce(b.paid_amount, 0) = 0 and e.starts_on < date '2026-11-01') as "оплат с нулём";

-- Отмена: вернуть 0.00 по списку из журнала аудита (занятия: update extra_sessions set amount = 0 where id in (...); оплаты: update extra_bookings set paid_amount = 0 where (session_id, player_id) in (...)).
