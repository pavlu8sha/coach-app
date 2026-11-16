-- Fedorov Lev и Fedorov Matvey (15.11.2026) и Polosin Kirill (16.11.2026), все «Платит за визит», пришли на тренировку чужой группы: за посещение 20 ₾, а не 15.
-- Условия: docs/PAY_PER_VISIT_GUEST_ACCEPTANCE.md, п. 5. Применять в SQL Editor ПОСЛЕ миграции 0201 и db/ops/preflight.sql, ОДНИМ запуском (весь файл).
-- Что делает: у их гостевых посещений ставит сумму own_visit.fee (по умолчанию 20 ₾). Неоплаченные: сумма 15 -> 20. Оплаченные меньше 20 (Kirill, 15 ₾ переводом): сумма посещения 15 -> 20, оплата и платежи не меняются, разница 5 ₾ остаётся долгом. Оплаченные на 20 и больше не трогает.
-- Платежи (service_payments), абонементы и баллы не меняются. Неоплаченные принимают в приложении: «Касса» → игрок → «К оплате» → «Доп. посещение». Доплату 5 ₾ за Kirill приложение пока принять не может (см. описание PR), её нужно записать отдельно.
-- Идемпотентно: повтор ничего не меняет. Игрок или посещение найдены неоднозначно: остановка с понятной ошибкой, ничего не меняется (весь блок откатывается).
-- Без begin/commit: SQL Editor Supabase выполняет весь блок одной транзакцией. После блока выводится проверочный список.
do $$
declare
  -- пары «игрок, день посещения»: Fedorov Lev и Matvey (посещение 15.11, не оплачено), Polosin Kirill (посещение 16.11, уже оплачено переводом 15 ₾)
  names text[] := array['Fedorov Lev', 'Fedorov Matvey', 'Polosin Kirill'];
  days date[] := array[date '2026-11-15', date '2026-11-15', date '2026-11-16'];
  i int; nm text; vday date; p players; cnt int; fee numeric; g record; got numeric; n_upd int := 0;
begin
  for i in 1..array_length(names, 1) loop
    nm := names[i]; vday := days[i];
    select count(*) into cnt from players where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(nm);
    if cnt <> 1 then raise exception 'Игрок "%" найден % раз(а), нужно ровно один. Проверьте написание.', nm, cnt; end if;
    select * into p from players where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(nm);
    if p.pay_mode <> 'per_visit' then raise exception 'Игрок "%" не в режиме «Платит за визит» (карточка игрока → Тип оплаты).', nm; end if;
    select count(*) into cnt from session_guests sg join sessions s on s.id = sg.session_id where sg.player_id = p.id and tbilisi_day(s.starts_at) = vday;
    if cnt <> 1 then raise exception 'Гостевых посещений "%" за % найдено % (нужно ровно одно).', nm, vday, cnt; end if;
    fee := own_visit_fee(p.club_id);
    select sg.session_id, sg.amount, sg.paid, sg.paid_amount into g from session_guests sg join sessions s on s.id = sg.session_id where sg.player_id = p.id and tbilisi_day(s.starts_at) = vday;
    if g.paid then
      got := coalesce(g.paid_amount, g.amount);
      if got >= fee then
        raise notice '% : посещение %: оплачено % (не меньше %), не меняю', nm, vday, got, fee;
      elsif g.amount = fee then
        raise notice '% : посещение %: сумма уже %, оплачено %, осталось доплатить %', nm, vday, fee, got, fee - got;
      else
        -- оплачено частично: поднимаем только сумму посещения, оплата (paid_amount) и платежи не меняются; разница остаётся долгом (родитель видит её в «Оплатах»)
        update session_guests set amount = fee where session_id = g.session_id and player_id = p.id and paid;
        n_upd := n_upd + 1;
        raise notice '% : посещение %: сумма % -> %, оплачено %, осталось доплатить %', nm, vday, g.amount, fee, got, fee - got;
      end if;
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

-- Проверка: по одной строке на игрока за свой день, сумма 20 (у Kirill paid_amount 15: осталось доплатить 5)
select pl.full_name, sg.amount, sg.paid, sg.paid_amount, g.name as host_group, tbilisi_day(s.starts_at) as day
  from session_guests sg join players pl on pl.id = sg.player_id join sessions s on s.id = sg.session_id join groups g on g.id = s.group_id
 where lower(pl.full_name) in ('fedorov lev', 'fedorov matvey', 'polosin kirill') and tbilisi_day(s.starts_at) in (date '2026-11-15', date '2026-11-16')
 order by pl.full_name;
