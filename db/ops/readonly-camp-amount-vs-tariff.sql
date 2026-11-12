-- Только чтение. Сверка: у кого из записанных на сбор сумма записи не равна текущей цене его тарифа.
-- Запускать после ЛЮБОЙ смены цены или названия тарифа (в карточке сбора или SQL-скриптом) и перед рассылкой об оплате.
-- Пустой результат = всё сходится. Строка = либо ручная сумма (скидка), либо снимок старой цены (нужен пересчёт).
-- Причина существования: сумма записи — снимок цены на момент записи, смена тарифа её не меняет (урок 2026-11-12 в CLAUDE.md).
select c.name as camp, c.starts_on, t.name as tariff, t.active as tariff_active, t.price as tariff_price,
       p.id as participant_id, coalesce(pl.full_name, p.guest_name) as who, p.amount,
       q.paid, p.amount - t.price as diff,
       case when q.paid > t.price then 'переплата при пересчёте: нужен возврат'
            when not t.active then 'тариф отключён'
            else 'сумма ≠ цене тарифа' end as note
  from camp_participants p
  join camps c on c.id = p.camp_id
  join camp_tariffs t on t.id = p.tariff_id
  left join players pl on pl.id = p.player_id
  cross join lateral (select coalesce(sum(x.amount), 0) as paid from camp_payments x where x.participant_id = p.id) q
 where p.status = 'registered' and c.ends_on >= current_date
   and (p.amount <> t.price or not t.active)
 order by c.starts_on, c.name, t.name, who;
