-- Read-only отчёты по issues #181, #179, #262, #258, #261. Только select: ничего не меняет.
-- Запускать в Supabase SQL Editor по одному блоку (порядок ниже). Имён игроков нет: только id, внутренний код (external_id) и группа.
-- Колонки проверены по миграциям 0001–0086 (players.full_name, payments.pay_month из 0059, individual_bookings.attended из 0034).
--
-- Порядок: 1) #181, 2) #179, 3) #262, 4) #258, 5) #261.
-- Сначала проверить #181 и #179: они короткие и не зависят от оплат.

-- =====================================================================
-- #181. Активные игроки без даты рождения
-- =====================================================================

-- 181.1. Сводка по статусам: сколько игроков без даты рождения всего
-- (в issue 4 активных, в памятке ожидается больше; это сверяем здесь)
select p.status, count(*) as без_даты
from players p
where p.birth_date is null
group by p.status
order by p.status;

-- 181.2. Список активных игроков без даты рождения
select p.external_id as код, p.id, g.name as группа, p.starts_on as начало
from players p
left join groups g on g.id = p.group_id
where p.status = 'active' and p.birth_date is null
order by p.external_id;


-- =====================================================================
-- #179. Матчи без состава или без счёта
-- =====================================================================

-- 179.1. Список проблемных матчей. Причина: нет счёта, нет состава (ни одной строки match_players) или есть строки без played=true.
select m.played_on, m.id as match_id, m.team, m.kind, m.tournament_id,
       m.goals_for, m.goals_against,
       (select count(*) from match_players mp where mp.match_id = m.id) as строк_состава,
       (select count(*) from match_players mp where mp.match_id = m.id and mp.played) as сыграло,
       case
         when m.goals_for is null or m.goals_against is null then 'нет счёта'
         when not exists (select 1 from match_players mp where mp.match_id = m.id) then 'нет состава'
         when not exists (select 1 from match_players mp where mp.match_id = m.id and mp.played) then 'состав без отметки игры'
       end as причина
from matches m
where m.played_on <= current_date
  and (
    m.goals_for is null or m.goals_against is null
    or not exists (select 1 from match_players mp where mp.match_id = m.id)
    or not exists (select 1 from match_players mp where mp.match_id = m.id and mp.played)
  )
order by m.played_on desc, m.team;

-- 179.2. Итог по причинам (для сверки с 29 матчами из quality.mjs)
select case
         when m.goals_for is null or m.goals_against is null then 'нет счёта'
         when not exists (select 1 from match_players mp where mp.match_id = m.id) then 'нет состава'
         when not exists (select 1 from match_players mp where mp.match_id = m.id and mp.played) then 'состав без отметки игры'
       end as причина,
       count(*) as матчей
from matches m
where m.played_on <= current_date
  and (
    m.goals_for is null or m.goals_against is null
    or not exists (select 1 from match_players mp where mp.match_id = m.id)
    or not exists (select 1 from match_players mp where mp.match_id = m.id and mp.played)
  )
group by 1
order by 2 desc;


-- =====================================================================
-- #262. Товарищеские матчи: оплата есть, участия нет
-- =====================================================================

-- 262.1. Виды матчей: проверить, что у товарищеских kind = 'friendly' (старые матчи могут быть без kind)
select m.kind, count(*) as матчей
from matches m
group by m.kind
order by m.kind nulls first;

-- 262.2. Оплата (отмечена или есть строки оплаты), но игрок не отмечен сыгравшим
with pays as (
  select mp.match_id, mp.player_id, sum(mp.amount) as оплачено_строками, count(*) as строк_оплат
  from match_payments mp
  group by mp.match_id, mp.player_id
)
select m.played_on, m.id as match_id, m.team, m.kind, mf.player_id,
       mf.amount as взнос, mf.paid as отмечено_оплачено,
       coalesce(pays.оплачено_строками, 0) as оплачено_строками, pays.строк_оплат,
       mpl.played as отмечен_сыгравшим
from match_fees mf
join matches m on m.id = mf.match_id
left join pays on pays.match_id = mf.match_id and pays.player_id = mf.player_id
left join match_players mpl on mpl.match_id = mf.match_id and mpl.player_id = mf.player_id
where m.kind = 'friendly'
  and (mf.paid or coalesce(pays.оплачено_строками, 0) > 0)
  and coalesce(mpl.played, false) = false
order by m.played_on, mf.player_id;

-- 262.3. Обратное: отмечен сыгравшим, но взноса или оплаты нет (участие без оплаты)
select m.played_on, m.id as match_id, m.team, mpl.player_id, mf.amount as взнос, mf.paid as отмечено_оплачено
from match_players mpl
join matches m on m.id = mpl.match_id
left join match_fees mf on mf.match_id = mpl.match_id and mf.player_id = mpl.player_id
where m.kind = 'friendly'
  and mpl.played
  and (mf.id is null or not mf.paid)
order by m.played_on, mpl.player_id;

-- 262.4. Отменённые оплаты (cancels) в товарищеских матчах: отмена и оригинал
select m.played_on, mp.match_id, mp.player_id, mp.id as payment_id, mp.amount, mp.paid_on,
       mp.cancels as отменяет, mp.created_at,
       exists (select 1 from match_payments c where c.cancels = mp.id) as отменена
from match_payments mp
join matches m on m.id = mp.match_id
where m.kind = 'friendly'
  and (mp.cancels is not null or exists (select 1 from match_payments c where c.cancels = mp.id))
order by m.played_on, mp.player_id, mp.created_at;


-- =====================================================================
-- #258. Индивидуальные и вратарские тренировки: история и оплата/посещение
-- =====================================================================

-- 258.1. Самая ранняя и поздняя дата по каждому виду (вратари = goalkeepers). Ожидаемый старт истории: 18.01.2026.
select i.goalkeepers as вратари, min(i.starts_at)::date as первая, max(i.starts_at)::date as последняя,
       count(*) as занятий
from individual_sessions i
group by i.goalkeepers;

-- 258.2. Занятия по месяцам: где пропадает период 18.01–28.03.2026
select date_trunc('month', i.starts_at)::date as месяц, i.goalkeepers as вратари, count(*) as занятий
from individual_sessions i
group by 1, 2
order by 1, 2;

-- 258.3. Занятия с кодом -GK, но без признака вратари (признак проставляет 0050; проверка после импорта)
select i.external_id, i.starts_at, i.goalkeepers
from individual_sessions i
where i.external_id like '%-GK' and not i.goalkeepers
order by i.starts_at;

-- 258.4. Оплачено, но посещение не отмечено или отмечено «не пришёл». Без имён: только id игрока.
select i.starts_at, i.external_id as занятие, b.player_id, b.amount, b.paid,
       case when b.attended is null then 'не отмечено' else 'отмечено: не пришёл' end as посещение
from individual_bookings b
join individual_sessions i on i.id = b.session_id
where b.paid and b.attended is distinct from true
order by i.starts_at, b.player_id;

-- 258.5. Посещение отмечено, но не оплачено
select i.starts_at, i.external_id as занятие, b.player_id, b.amount
from individual_bookings b
join individual_sessions i on i.id = b.session_id
where b.attended and not b.paid
order by i.starts_at, b.player_id;

-- 258.6. Неоднозначно: один игрок записан на два занятия в один день
select b.player_id, i.starts_at::date as день, count(*) as занятий,
       string_agg(i.external_id, ', ' order by i.starts_at) as коды
from individual_bookings b
join individual_sessions i on i.id = b.session_id
group by b.player_id, i.starts_at::date
having count(*) > 1
order by день, b.player_id;


-- =====================================================================
-- #261. Оплаты прошлых месяцев при переходе между группами
-- =====================================================================

-- 261.1. Игроки, у которых в абонементах больше одной группы (группа месяца = subscriptions.group_id, иначе текущая players.group_id)
with sg as (
  select s.player_id, s.month, coalesce(s.group_id, p.group_id) as gid
  from subscriptions s
  join players p on p.id = s.player_id
)
select sg.player_id, count(distinct sg.gid) as групп, min(sg.month) as с_месяца, max(sg.month) as по_месяц
from sg
group by sg.player_id
having count(distinct sg.gid) > 1
order by групп desc, sg.player_id;

-- 261.2. Месяцы, где группа в абонементе отличается от текущей группы игрока (переходы)
select s.player_id, s.month, s.group_id as группа_в_абонементе, p.group_id as текущая_группа
from subscriptions s
join players p on p.id = s.player_id
where s.group_id is not null and s.group_id is distinct from p.group_id
order by s.player_id, s.month;

-- 261.3. Абонементы без группы ни в строке, ни у игрока: группу не определить
select s.player_id, s.month, s.amount_due
from subscriptions s
join players p on p.id = s.player_id
where coalesce(s.group_id, p.group_id) is null
order by s.month, s.player_id;

-- 261.4. Начислено не совпадает с действующим тарифом группы на месяц (скидки и списания исключены)
select s.player_id, s.month, coalesce(s.group_id, p.group_id) as группа,
       s.amount_due as начислено,
       tariff_for(p.club_id, coalesce(s.group_id, p.group_id), s.month) as тариф_на_месяц
from subscriptions s
join players p on p.id = s.player_id
where not s.discount and not s.written_off
  and s.amount_due is distinct from tariff_for(p.club_id, coalesce(s.group_id, p.group_id), s.month)
order by s.month, s.player_id;

-- 261.5. Оплаты по месяцам (pay_month, как в parent_debts): начислено и оплачено, расхождения. Пометка, менялась ли группа у игрока.
with pm as (
  select pay.player_id, pay.pay_month, sum(pay.amount) as оплачено
  from payments pay
  group by pay.player_id, pay.pay_month
), multi as (
  select s.player_id
  from subscriptions s
  join players p on p.id = s.player_id
  group by s.player_id
  having count(distinct coalesce(s.group_id, p.group_id)) > 1
)
select s.player_id, s.month, coalesce(s.group_id, p.group_id) as группа,
       s.amount_due as начислено, coalesce(pm.оплачено, 0) as оплачено,
       s.amount_due - coalesce(pm.оплачено, 0) as разница,
       s.player_id in (select player_id from multi) as игрок_менял_группу
from subscriptions s
join players p on p.id = s.player_id
left join pm on pm.player_id = s.player_id and pm.pay_month = s.month
where not s.discount and not s.written_off
  and s.amount_due is distinct from coalesce(pm.оплачено, 0)
order by игрок_менял_группу desc, s.month, s.player_id;

-- 261.6. Оплаты месяца без строки абонемента (сироты): по ним не видно, какая группа считалась
select pay.player_id, pay.pay_month, sum(pay.amount) as оплачено, count(*) as строк
from payments pay
where pay.subscription_id is null
  and not exists (select 1 from subscriptions s where s.player_id = pay.player_id and s.month = pay.pay_month)
group by pay.player_id, pay.pay_month
order by pay.pay_month, pay.player_id;
