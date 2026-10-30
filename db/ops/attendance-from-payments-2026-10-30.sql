-- Отметить посещение по оплате: #258 (индивидуальные) и #262 (товарищеские матчи).
-- Решение владельца 2026-10-30: в этих тренировках и матчах оплата = посещение.
--
-- ЗАПУСКАТЬ ТОЛЬКО ПОСЛЕ СУББОТНЕГО ИМПОРТА и после проверки шага 1. Не раньше.
-- Шаг 1: счётчики до записи (только select). Ожидаем: 370 и 51.
-- Шаг 2: запись в транзакции. По умолчанию откат (rollback). Чтобы записать, заменить rollback на commit.
-- Шаг 3: счётчики после записи (только select). Ожидаем: 0 и 0.
-- Не трогаем: 2 случая «посещение без оплаты» (#258) и 6 участий без оплаты (#262). Их решение отдельное.

-- =====================================================================
-- Шаг 1. Что будет изменено (только чтение)
-- =====================================================================

-- 1.1. #258: оплачено, посещение не отмечено (attended is null). Ожидаем 370.
select count(*) as индивидуальных_к_отметке
from individual_bookings
where paid and attended is null;

-- 1.2. #262: товарищеский матч, взнос отмечен оплаченным, игрок не отмечен сыгравшим. Ожидаем 51.
select count(*) as товарищеских_к_отметке
from match_fees mf
join matches m on m.id = mf.match_id
where m.kind = 'friendly'
  and mf.paid
  and not exists (
    select 1 from match_players mp
    where mp.match_id = mf.match_id and mp.player_id = mf.player_id and mp.played
  );

-- =====================================================================
-- Шаг 2. Запись. По умолчанию откат.
-- =====================================================================
begin;

-- 2.1. #258: оплата = посещение (только там, где посещение ещё не отмечено)
update individual_bookings
set attended = true
where paid and attended is null;

-- 2.2. #262: оплата = участие. Строка состава создаётся, если её не было, и отмечается сыгравшим.
insert into match_players (match_id, player_id, played)
select mf.match_id, mf.player_id, true
from match_fees mf
join matches m on m.id = mf.match_id
where m.kind = 'friendly'
  and mf.paid
  and not exists (
    select 1 from match_players mp
    where mp.match_id = mf.match_id and mp.player_id = mf.player_id and mp.played
  )
on conflict (match_id, player_id) do update set played = true;

rollback;  -- заменить на commit после проверки шага 1 и согласования

-- =====================================================================
-- Шаг 3. Проверка после записи (только чтение). Ожидаем 0 и 0.
-- Смотреть только после commit. После rollback счётчики останутся 370 и 51.
-- =====================================================================

-- 3.1. #258
select count(*) as индивидуальных_осталось
from individual_bookings
where paid and attended is null;

-- 3.2. #262
select count(*) as товарищеских_осталось
from match_fees mf
join matches m on m.id = mf.match_id
where m.kind = 'friendly'
  and mf.paid
  and not exists (
    select 1 from match_players mp
    where mp.match_id = mf.match_id and mp.player_id = mf.player_id and mp.played
  );
