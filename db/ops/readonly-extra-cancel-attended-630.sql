-- Только чтение (#630). НЕ запускать в проде без слова Павла. Исправление найденного (backfill) отдельное решение владельца.
-- Показывает записи отменённых дополнительных тренировок, оставшиеся с прежней (до 0196) логикой отмены:
--   'attended_true'        : отметка «был», посещение осталось, баллы закрыты отменой, строки журнала отмен нет;
--   'paid_attended_false'  : оплаченная запись с отметкой «не был», строки журнала отмен нет (деньги без решения);
--   'unpaid_attended_false': неоплаченная запись с отметкой «не был», строки журнала отмен нет (информационно).
-- Пустой результат = аномалий нет. Сводка по видам первым запросом, детали вторым.
with a as (
  select s.id as session_id, s.starts_on, s.place, s.cancelled_at, b.player_id, b.attended, b.paid, b.paid_amount,
         case when b.attended is true then 'attended_true'
              when b.attended is false and b.paid then 'paid_attended_false'
              else 'unpaid_attended_false' end as kind
    from extra_sessions s
    join extra_bookings b on b.session_id = s.id
   where s.cancelled_at is not null
     and b.attended is not null
     and not exists (select 1 from booking_cancellations c where c.kind = 'extra' and c.session_id = s.id and c.player_id = b.player_id)
)
select kind, count(*) as bookings, count(distinct session_id) as sessions, coalesce(sum(paid_amount) filter (where paid), 0) as paid_sum
  from a group by kind order by kind;

with a as (
  select s.id as session_id, s.starts_on, s.place, s.cancelled_at, b.player_id, b.attended, b.paid, b.paid_amount,
         case when b.attended is true then 'attended_true'
              when b.attended is false and b.paid then 'paid_attended_false'
              else 'unpaid_attended_false' end as kind
    from extra_sessions s
    join extra_bookings b on b.session_id = s.id
   where s.cancelled_at is not null
     and b.attended is not null
     and not exists (select 1 from booking_cancellations c where c.kind = 'extra' and c.session_id = s.id and c.player_id = b.player_id)
)
select a.kind, a.starts_on, a.place, a.cancelled_at, pl.full_name, a.attended, a.paid, a.paid_amount,
       (select count(*) from points_ledger l where l.source_type = 'extra' and l.source_id = a.session_id
           and l.player_id = a.player_id and l.status = 'active') as active_points
  from a join players pl on pl.id = a.player_id
 order by a.kind, a.starts_on, pl.full_name;
