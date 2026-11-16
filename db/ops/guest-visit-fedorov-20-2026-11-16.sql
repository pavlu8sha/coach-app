-- Fedorov Lev и Fedorov Matvey («Платит за визит» с 01.11.2026) пришли 15.11.2026 на тренировку чужой группы: за посещение 20 ₾, а не 15.
-- Условия: docs/PAY_PER_VISIT_GUEST_ACCEPTANCE.md, п. 5. Применять в SQL Editor ПОСЛЕ миграции 0201 и db/ops/preflight.sql, ОДНИМ запуском (весь файл).
-- Что делает: у их неоплаченных гостевых посещений за 15.11.2026 ставит сумму own_visit.fee (по умолчанию 20 ₾). Оплаченные не трогает и сообщает.
-- Платежи (service_payments), абонементы, баллы и долги не меняются. Оплату потом принимают в приложении: «Касса» → игрок → «К оплате» → «Доп. посещение».
-- Идемпотентно: повтор ничего не меняет. Игрок или посещение найдены неоднозначно: остановка с понятной ошибкой, ничего не меняется (весь блок откатывается).
-- Без begin/commit: SQL Editor Supabase выполняет весь блок одной транзакцией. После блока выводится проверочный список.
do $$
declare
  names text[] := array['Fedorov Lev', 'Fedorov Matvey'];
  vday date := date '2026-11-15';
  nm text; p players; cnt int; fee numeric; g record; n_upd int := 0;
begin
  foreach nm in array names loop
    select count(*) into cnt from players where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(nm);
    if cnt <> 1 then raise exception 'Игрок "%" найден % раз(а), нужно ровно один. Проверьте написание.', nm, cnt; end if;
    select * into p from players where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(nm);
    if p.pay_mode <> 'per_visit' then raise exception 'Игрок "%" не в режиме «Платит за визит» (карточка игрока → Тип оплаты).', nm; end if;
    select count(*) into cnt from session_guests sg join sessions s on s.id = sg.session_id where sg.player_id = p.id and tbilisi_day(s.starts_at) = vday;
    if cnt <> 1 then raise exception 'Гостевых посещений "%" за % найдено % (нужно ровно одно).', nm, vday, cnt; end if;
    fee := own_visit_fee(p.club_id);
    select sg.session_id, sg.amount, sg.paid into g from session_guests sg join sessions s on s.id = sg.session_id where sg.player_id = p.id and tbilisi_day(s.starts_at) = vday;
    if g.paid then
      raise notice '% : посещение %: уже оплачено (сумма %), не меняю', nm, vday, g.amount;
    elsif g.amount = fee then
      raise notice '% : посещение %: сумма уже %, ничего не делаю', nm, vday, fee;
    else
      update session_guests set amount = fee where session_id = g.session_id and player_id = p.id and not paid;
      n_upd := n_upd + 1;
      raise notice '% : посещение %: сумма % -> %', nm, vday, g.amount, fee;
    end if;
  end loop;
  raise notice 'Изменено посещений: %', n_upd;
end $$;

-- Проверка: должно быть по одной строке на игрока, сумма 20 (или оплачено)
select pl.full_name, sg.amount, sg.paid, sg.paid_amount, g.name as host_group, tbilisi_day(s.starts_at) as day
  from session_guests sg join players pl on pl.id = sg.player_id join sessions s on s.id = sg.session_id join groups g on g.id = s.group_id
 where lower(pl.full_name) in ('fedorov lev', 'fedorov matvey') and tbilisi_day(s.starts_at) = date '2026-11-15'
 order by pl.full_name;
