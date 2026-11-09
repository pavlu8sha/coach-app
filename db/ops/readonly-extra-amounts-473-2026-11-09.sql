-- #473, только чтение. Проверка после отметки посещаемости и разбор сумм: почему у занятий сумма не 15.
-- Запускает Павел в SQL Editor. Ничего не меняет.

-- 1. По каждому занятию: сумма занятия, сколько оплаченных, у скольких сумма оплаты 0/пустая, какие суммы оплат встречаются, сколько отмечено «Был»
select e.starts_on as "дата", e.amount as "сумма занятия", e.place as "место",
       count(*) filter (where b.paid) as "оплачено",
       count(*) filter (where b.paid and coalesce(b.paid_amount, 0) = 0) as "оплат с суммой 0/пусто",
       string_agg(distinct b.paid_amount::text, ', ') filter (where b.paid) as "суммы оплат",
       string_agg(distinct b.method, ', ') filter (where b.paid) as "способы",
       count(*) filter (where b.attended is true) as "был",
       e.id as "id занятия"
  from extra_sessions e
  left join extra_bookings b on b.session_id = e.id
 where e.cancelled_at is null
 group by e.id, e.starts_on, e.amount, e.place
 order by e.starts_on;

-- 2. Итог проверки посещаемости: должно быть 361 «Был» и 0 без отметки среди занятий до 01.11
select count(*) filter (where b.attended is true) as "был",
       count(*) filter (where b.attended is null) as "без отметки",
       count(distinct b.session_id) as "занятий"
  from extra_bookings b join extra_sessions e on e.id = b.session_id
 where e.starts_on < date '2026-11-01';
