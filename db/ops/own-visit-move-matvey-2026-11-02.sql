-- Fedorov Matvey (U7-A): платил за визит в ноябре, но 20 ₾ за тренировку 02.11.2026 внесли как «Абонемент» (платёж от 03.11, перевод, месяц ноябрь, без абонемента).
-- Переносим эту оплату в «Оплату за визит»: визит 02.11 (20 ₾, оплачен переводом) + минусовая строка к платежу абонемента.
-- Условия: ПОСЛЕ миграции 0200 (она применена) и после того, как в карточке игрока выставлено «Платит за визит» с 01.11.2026. Применять в SQL Editor ОДНИМ запуском всего файла.
-- Что делает:
--   1) проверяет всё до записи: ровно один игрок, режим «Платит за визит» с даты не позже 02.11; ровно одно занятие его группы 02.11 с отметкой «Был»; визита за это занятие ещё нет;
--      ровно один платёж 20 ₾ от 03.11 (перевод, месяц ноябрь, без абонемента), ещё не отменённый; own_visit.fee = 20;
--   2) в payments пишет минусовую строку (cancels = этот платёж, та же дата 03.11): итог кассы за 03.11 не меняется, платёж в абонемент гасится;
--   3) создаёт own_visits (занятие 02.11, 20 ₾, оплачен, перевод) и запись service_payments вид own_visit на 20 ₾ с датой 03.11.
-- Платежи не удаляются и не правятся (журнал неизменяем). Идемпотентно: если визит за 02.11 уже оплачен, ничего не делает.
-- Без begin/commit: SQL Editor Supabase выполняет блок одной транзакцией. После блока выводится проверочная выборка.
do $$
declare
  nm constant text := 'Fedorov Matvey';
  vday constant date := date '2026-11-02';
  payday constant date := date '2026-11-03';
  pl players; cnt int; ses sessions; fee numeric; orig payments; ov own_visits;
begin
  select count(*) into cnt from players where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(nm);
  if cnt <> 1 then raise exception 'Игрок "%" найден % раз(а), нужно ровно один.', nm, cnt; end if;
  select * into pl from players where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(nm);
  if pl.pay_mode <> 'per_visit' or pl.pay_mode_from is null or pl.pay_mode_from > vday then
    raise exception 'Игрок "%": нужно «Платит за визит» с даты не позже % (карточка игрока → Тип оплаты). Сейчас: % с %.', nm, vday, pl.pay_mode, pl.pay_mode_from;
  end if;

  select count(*) into cnt from sessions s
   where s.group_id = pl.group_id and tbilisi_day(s.starts_at) = vday
     and exists (select 1 from attendance a where a.session_id = s.id and a.player_id = pl.id and a.status = 'present');
  if cnt <> 1 then raise exception 'Занятий группы игрока за % с отметкой «Был» найдено % (нужно ровно одно).', vday, cnt; end if;
  select s.* into ses from sessions s
   where s.group_id = pl.group_id and tbilisi_day(s.starts_at) = vday
     and exists (select 1 from attendance a where a.session_id = s.id and a.player_id = pl.id and a.status = 'present');

  select * into ov from own_visits where session_id = ses.id and player_id = pl.id;
  if found and ov.paid then
    raise notice '%: визит % уже оплачен (%), ничего не делаю', nm, vday, coalesce(ov.paid_amount, ov.amount);
    return;
  end if;
  if found then raise exception 'Визит "%" за % уже есть, но не оплачен: нестандартное состояние, остановка.', nm, vday; end if;

  fee := own_visit_fee(pl.club_id);
  if fee <> 20 then raise exception 'own_visit.fee = %, скрипт рассчитан на 20.', fee; end if;

  select count(*) into cnt from payments p
   where p.player_id = pl.id and p.amount = 20 and p.paid_on = payday and p.method = 'Перевод'
     and p.pay_month = date '2026-11-01' and p.subscription_id is null and p.cancels is null
     and not exists (select 1 from payments c where c.cancels = p.id);
  if cnt <> 1 then raise exception 'Платежей 20 ₾ от % (перевод, ноябрь, без абонемента, не отменён) найдено % (нужно ровно один).', payday, cnt; end if;
  select p.* into orig from payments p
   where p.player_id = pl.id and p.amount = 20 and p.paid_on = payday and p.method = 'Перевод'
     and p.pay_month = date '2026-11-01' and p.subscription_id is null and p.cancels is null
     and not exists (select 1 from payments c where c.cancels = p.id);

  insert into payments (player_id, amount, paid_on, method, cancels) values (pl.id, -orig.amount, orig.paid_on, orig.method, orig.id);
  insert into own_visits (session_id, player_id, amount, paid, paid_amount, method) values (ses.id, pl.id, fee, true, orig.amount, orig.method);
  perform service_payment_add('own_visit', ses.id, pl.id, orig.amount, orig.paid_on, orig.method);
  raise notice '%: платёж % (20 ₾, абонемент) погашен минусом, создан оплаченный визит % (20 ₾, перевод)', nm, orig.id, vday;
end $$;

-- Проверка: платежи Matvey за ноябрь (абонемент: +20 и -20, итого 0) и визит 02.11 (оплачен 20)
select 'payments' as src, p.amount, p.paid_on, p.method, p.cancels is not null as is_cancel
  from payments p join players pl on pl.id = p.player_id
 where pl.full_name = 'Fedorov Matvey' and p.pay_month = date '2026-11-01'
union all
select 'own_visit', sp.amount, sp.paid_on, sp.method, sp.cancels is not null
  from service_payments sp join players pl on pl.id = sp.player_id
 where pl.full_name = 'Fedorov Matvey' and sp.kind = 'own_visit'
union all
select 'visit_row', v.amount, null, v.method, v.paid
  from own_visits v join players pl on pl.id = v.player_id
 where pl.full_name = 'Fedorov Matvey';
