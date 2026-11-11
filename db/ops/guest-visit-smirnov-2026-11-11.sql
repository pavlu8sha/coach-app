-- Разовое посещение: Smirnov Timofei на тренировке U9-B 11.11.2026 (решение владельца 2026-11-11: учёт с сегодняшней тренировки).
-- Условия: docs/GUEST_VISIT_ACCEPTANCE.md, п. 11. Применять в SQL Editor ПОСЛЕ миграции 0178 и db/ops/preflight.sql.
-- Что делает: добавляет игрока гостем на занятие группы U9-B за 11.11 (сумма из настройки visit.fee, по умолчанию 15 ₾; баллы начислит триггер)
-- и, если ниже указан способ, записывает оплату за это посещение в service_payments (вид visit). Абонемент и долг не меняются.
-- Идемпотентно: повтор ничего не добавляет и не платит второй раз. Если игрок или занятие не найдены однозначно, скрипт останавливается с понятной ошибкой и ничего не меняет.
-- Занятие группы за 11.11 должно быть уже открыто (тренер сохранил отметки группы или добавил гостя в приложении). Автором оплаты в журнале будет пусто (SQL Editor).
-- Способ оплаты: 'Наличные', 'Перевод' или null (посещение учесть, оплату не записывать).
begin;

create temp table x_params as select 'Smirnov Timofei'::text as player_name, 'U9-B'::text as group_name, date '2026-11-11' as day, null::text as pay_method;
-- ↑ при оплате замените null::text на 'Наличные'::text или 'Перевод'::text

do $$
declare p players; s sessions; cnt int; prm x_params; fee numeric; added boolean := false; paid_now boolean := false;
begin
  select * into prm from x_params;
  select count(*) into cnt from players where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(prm.player_name);
  if cnt <> 1 then raise exception 'Игрок "%" найден % раз(а), нужно ровно один. Проверьте написание.', prm.player_name, cnt; end if;
  select * into p from players where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(prm.player_name);
  if p.status <> 'active' then raise exception 'Игрок "%" не в статусе «Занимается» (%).', prm.player_name, p.status; end if;

  select count(*) into cnt from sessions s2 join groups g on g.id = s2.group_id
   where lower(g.name) = lower(prm.group_name) and tbilisi_day(s2.starts_at) = prm.day and s2.kind = 'training';
  if cnt <> 1 then raise exception 'Занятий группы "%" за % найдено % (нужно ровно одно). Сначала сохраните отметки группы в приложении.', prm.group_name, prm.day, cnt; end if;
  select s2.* into s from sessions s2 join groups g on g.id = s2.group_id
   where lower(g.name) = lower(prm.group_name) and tbilisi_day(s2.starts_at) = prm.day and s2.kind = 'training';

  if p.group_id is not distinct from s.group_id then raise exception 'Игрок из группы "%": его отмечают в списке группы, а не гостем.', prm.group_name; end if;

  if not exists (select 1 from session_guests where session_id = s.id and player_id = p.id) then
    fee := guest_visit_fee((select club_id from groups where id = s.group_id));
    insert into session_guests (session_id, player_id, amount) values (s.id, p.id, fee);
    added := true;
  end if;

  if prm.pay_method is not null and not (select paid from session_guests where session_id = s.id and player_id = p.id) then
    perform service_method_ok(prm.pay_method);
    update session_guests set paid = true, paid_amount = amount, method = prm.pay_method where session_id = s.id and player_id = p.id;
    perform service_payment_add('visit', s.id, p.id, (select amount from session_guests where session_id = s.id and player_id = p.id), prm.day, prm.pay_method);
    paid_now := true;
  end if;
  raise notice 'Гость % добавлен: %, оплата записана: %', p.full_name, added, paid_now;
end $$;

-- Результат: гость, сумма, оплата, баллы за это занятие
select p.full_name, g.name as own_group, sg.amount, sg.paid, sg.method,
       (select string_agg(l.points::text || ' (' || l.status || ')', ', ') from points_ledger l where l.source_type = 'group_session' and l.source_id = sg.session_id and l.player_id = sg.player_id) as points
  from session_guests sg join players p on p.id = sg.player_id left join groups g on g.id = p.group_id
 where sg.session_id in (select s2.id from sessions s2 join groups g2 on g2.id = s2.group_id where lower(g2.name) = 'u9-b' and tbilisi_day(s2.starts_at) = date '2026-11-11')
   and lower(regexp_replace(trim(p.full_name), '\s+', ' ', 'g')) = 'smirnov timofei';

commit;
