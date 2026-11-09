-- #473, этап 1: только чтение (read-only). Ничего не меняет.
-- Запускает Павел в SQL Editor на проде, результат выгрузить в CSV.
-- Таблицы: extra_sessions (занятие), extra_bookings (запись + paid/paid_amount + attended), service_payments (журнал оплат с 0083).
-- Историческая оплата до 0083 лежит только в extra_bookings.paid, в service_payments её нет — поэтому оплата = extra_bookings.paid.

-- 0. Дата старта баллов (для оценки побочного начисления баллов при отметке «Был»)
select 'points_start' as "параметр", value as "значение"
  from club_settings where key = 'points_start' and scope = '';

-- 1. Сводка по всем дополнительным тренировкам
with b as (
  select e.id, e.starts_on, count(x.player_id) as записей,
         count(*) filter (where x.paid) as оплачено,
         count(*) filter (where x.attended is not null) as отмечено,
         count(*) filter (where x.paid and x.attended is null) as оплачено_без_отметки,
         count(*) filter (where not x.paid and x.attended is null) as без_оплаты_без_отметки,
         count(*) filter (where not x.paid and x.attended is true) as был_без_оплаты,
         count(*) filter (where x.paid and x.attended is false) as оплачено_не_пришёл
    from extra_sessions e
    left join extra_bookings x on x.session_id = e.id
   group by e.id, e.starts_on
)
select b.starts_on as "дата", b.записей, b.оплачено, b.отмечено,
       b.оплачено_без_отметки, b.без_оплаты_без_отметки, b.был_без_оплаты, b.оплачено_не_пришёл,
       b.id as "id занятия"
  from b
 order by b.starts_on;

-- 2. Итоги для dry-run (кандидаты на восстановление «Был» по оплате)
select
  count(*) filter (where x.paid and x.attended is null)                     as "кандидаты по оплате (отметить «Был»)",
  count(distinct x.session_id) filter (where x.paid and x.attended is null) as "занятий с такими кандидатами",
  count(*) filter (where not x.paid and x.attended is null)                 as "неоплаченные без отметки (НЕ трогать без подтверждения)",
  count(*) filter (where x.paid and x.attended is false)                    as "оплачено, но отмечено «не пришёл» (НЕ трогать)",
  count(*) filter (where x.attended is true)                                as "уже «Был» (исключить из backfill)"
  from extra_bookings x
  join extra_sessions e on e.id = x.session_id
 where e.cancelled_at is null;

-- 3. Оплаты с суммой 0 или пустым способом (проверить до backfill)
select e.starts_on as "дата", x.player_id as "player_id", x.paid_amount as "сумма", x.method as "способ"
  from extra_bookings x join extra_sessions e on e.id = x.session_id
 where x.paid and (coalesce(x.paid_amount, 0) = 0 or x.method is null or trim(x.method) = '')
 order by e.starts_on;

-- 4. Отменённые занятия с оплатами (исключаются из backfill, решить отдельно)
select e.starts_on as "дата", count(*) filter (where x.paid) as "оплаченных записей", e.id as "id занятия"
  from extra_sessions e join extra_bookings x on x.session_id = e.id
 where e.cancelled_at is not null
 group by e.id, e.starts_on order by e.starts_on;

-- 5. Список для поиска единственного неоплаченного посещения: записи без оплаты и без отметки
--    (игрок назван владельцем отдельно; здесь только id, без персональных данных)
select e.starts_on as "дата", e.id as "id занятия", x.player_id as "player_id", x.attended as "отметка"
  from extra_bookings x join extra_sessions e on e.id = x.session_id
 where not x.paid and x.attended is null and e.cancelled_at is null
 order by e.starts_on
 limit 500;

-- 6. Контроль: оплаты, которые есть в журнале service_payments, но в extra_bookings не отмечены «оплачено» (расхождение)
select sp.ref_id as "id занятия", sp.player_id, sum(sp.amount) as "сумма в журнале"
  from service_payments sp
 where sp.kind = 'extra'
 group by sp.ref_id, sp.player_id
having sum(sp.amount) <> 0
   and not exists (select 1 from extra_bookings x where x.session_id = sp.ref_id and x.player_id = sp.player_id and x.paid);
