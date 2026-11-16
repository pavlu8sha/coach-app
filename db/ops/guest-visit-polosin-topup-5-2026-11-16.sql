-- Polosin Kirill: гостевое посещение 16.11.2026 (U9-B) стоит 20 ₾, оплачено 15 ₾ переводом. Принимаем доплату 5 ₾ (в «Кассе» по уже оплаченной строке принять нельзя).
-- Применять в SQL Editor ПОСЛЕ скрипта guest-visit-fedorov-20-2026-11-16.sql (он поднял сумму посещения до 20), ОДНИМ запуском всего файла.
-- СПОСОБ доплаты задаётся в строке method ниже: 'Перевод' или 'Наличные'. Дата оплаты: сегодня (Тбилиси), касса за этот день получает +5.
-- Что делает: проверяет (один игрок, одно посещение 16.11 на 20 ₾, оплачено ровно 15, в журнале ровно один платёж 15 ₾ вида visit); добавляет в service_payments платёж 5 ₾ вида visit (ref = занятие) и ставит в посещении paid_amount = 20.
-- Платежи не удаляются и не правятся. Идемпотентно: если оплачено уже 20, ничего не делает.
-- Без begin/commit: SQL Editor Supabase выполняет блок одной транзакцией. После блока выводится проверочная выборка.
do $$
declare
  nm constant text := 'Polosin Kirill';
  vday constant date := date '2026-11-16';
  method constant text := 'Перевод';
  p players; cnt int; g record; got numeric; sp_sum numeric; sp_cnt int;
begin
  select count(*) into cnt from players where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(nm);
  if cnt <> 1 then raise exception 'Игрок "%" найден % раз(а), нужно ровно один.', nm, cnt; end if;
  select * into p from players where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(nm);
  select count(*) into cnt from session_guests sg join sessions s on s.id = sg.session_id where sg.player_id = p.id and tbilisi_day(s.starts_at) = vday;
  if cnt <> 1 then raise exception 'Гостевых посещений "%" за % найдено % (нужно ровно одно).', nm, vday, cnt; end if;
  select sg.session_id, sg.amount, sg.paid, sg.paid_amount into g from session_guests sg join sessions s on s.id = sg.session_id where sg.player_id = p.id and tbilisi_day(s.starts_at) = vday;
  if not g.paid then raise exception 'Посещение "%" за % не оплачено: доплата не нужна, принимайте оплату в Кассе.', nm, vday; end if;
  got := coalesce(g.paid_amount, g.amount);
  if got >= g.amount then
    raise notice '%: посещение %: оплачено % из %, доплата не нужна', nm, vday, got, g.amount;
    return;
  end if;
  if g.amount <> 20 or got <> 15 then raise exception 'Ожидалось: сумма 20, оплачено 15; в базе: сумма %, оплачено %. Остановка.', g.amount, got; end if;
  select count(*), coalesce(sum(amount), 0) into sp_cnt, sp_sum from service_payments where kind = 'visit' and ref_id = g.session_id and player_id = p.id;
  if sp_cnt <> 1 or sp_sum <> 15 then raise exception 'В журнале по этому посещению строк %, сумма % (ожидалась одна строка 15 ₾). Остановка.', sp_cnt, sp_sum; end if;
  perform service_method_ok(method);
  perform service_payment_add('visit', g.session_id, p.id, g.amount - got, tbilisi_day(now()), method);
  update session_guests set paid_amount = g.amount where session_id = g.session_id and player_id = p.id;
  raise notice '%: доплата % ₾ (%), посещение % оплачено полностью (%)', nm, g.amount - got, method, vday, g.amount;
end $$;

-- Проверка: посещение 20, оплачено 20; в журнале 15 + 5
select 'visit_row' as src, sg.amount, sg.paid_amount, sg.paid, null::date as paid_on, sg.method
  from session_guests sg join players pl on pl.id = sg.player_id join sessions s on s.id = sg.session_id
 where pl.full_name = 'Polosin Kirill' and tbilisi_day(s.starts_at) = date '2026-11-16'
union all
select 'journal', sp.amount, null, null, sp.paid_on, sp.method
  from service_payments sp join players pl on pl.id = sp.player_id
 where pl.full_name = 'Polosin Kirill' and sp.kind = 'visit';
