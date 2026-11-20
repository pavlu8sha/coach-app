-- Дозаполнить недостающие визиты за плату у всех игроков «Платит за визит» (после миграции 0213). Создаёт только неоплаченные строки own_visits за занятия с «Был» с даты pay_mode_from.
-- Сначала только чтение: какие визиты будут созданы.
select pl.full_name, tbilisi_day(s.starts_at) as day, g.name as grp
from players pl
join attendance a on a.player_id = pl.id and a.status = 'present'
join sessions s on s.id = a.session_id
join groups g on g.id = s.group_id
where pl.pay_mode = 'per_visit' and pl.pay_mode_from is not null
  and tbilisi_day(s.starts_at) between pl.pay_mode_from and tbilisi_day(now())
  and not exists (select 1 from own_visits v where v.session_id = s.id and v.player_id = pl.id)
order by 1, 2;
-- Затем выполнить отдельно (после проверки списка выше):
-- select pl.full_name, own_visits_backfill(pl.id) as created from players pl where pl.pay_mode = 'per_visit' and pl.pay_mode_from is not null order by 1;
