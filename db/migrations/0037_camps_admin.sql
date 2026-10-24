-- Сборы для администратора (перенос из старого приложения: Camps.js).
-- Таблицы — миграции 0003/0010 (сборы, тарифы, участники, платежи; записывает только администратор).
-- Функции держат правила в базе:
--   • участник привязан к тарифу сбора; сумма по умолчанию — цена тарифа;
--   • платёж — положительная сумма, вид «бронь» или «оплата»; отмена платежа — отдельная строка с минусом (вид «возврат»),
--     ничего не удаляется, повторно отменить тот же платёж нельзя;
--   • итог по участнику не уходит ниже нуля; отказ участника ставится статусом, строка остаётся.
create or replace function camp_assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function camp_save(cid uuid, nm text, loc text, d1 date, d2 date, fee numeric, fee_by date, pay_by date, act boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; r uuid;
begin
  perform camp_assert_admin();
  if nullif(trim(nm), '') is null then raise exception 'name required' using errcode = '22023'; end if;
  if d1 is null or d2 is null or d2 < d1 then raise exception 'bad dates' using errcode = '22023'; end if;
  if fee is null or fee < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if cid is null then
    select id into c from clubs order by id limit 1;
    insert into camps (club_id, name, location, starts_on, ends_on, booking_fee, booking_deadline, full_payment_deadline, active)
    values (c, trim(nm), nullif(trim(loc), ''), d1, d2, fee, fee_by, pay_by, coalesce(act, true)) returning id into r;
  else
    update camps set name = trim(nm), location = nullif(trim(loc), ''), starts_on = d1, ends_on = d2, booking_fee = fee,
      booking_deadline = fee_by, full_payment_deadline = pay_by, active = coalesce(act, true) where id = cid returning id into r;
    if r is null then raise exception 'camp not found' using errcode = 'P0002'; end if;
  end if;
  return r;
end $$;

-- Тариф: добавить или изменить цену и активность по названию. Тариф не удаляется (его можно снять с «активен»).
create or replace function camp_tariff_save(cid uuid, nm text, pr numeric, act boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform camp_assert_admin();
  if nullif(trim(nm), '') is null or pr is null or pr < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if not exists (select 1 from camps where id = cid) then raise exception 'camp not found' using errcode = 'P0002'; end if;
  insert into camp_tariffs (camp_id, name, price, active) values (cid, trim(nm), pr, coalesce(act, true))
  on conflict (camp_id, name) do update set price = excluded.price, active = excluded.active;
end $$;

-- Записать игрока на сбор (если ранее отказался — вернуть статус «записан»)
create or replace function camp_register(cid uuid, p uuid, tid uuid, amt numeric, tshirt text, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; pc uuid; tp numeric; r uuid; st text;
begin
  perform camp_assert_admin();
  select club_id into c from camps where id = cid;
  if c is null then raise exception 'camp not found' using errcode = 'P0002'; end if;
  select club_id into pc from players where id = p;
  if pc is null or pc <> c then raise exception 'player not in club' using errcode = '22023'; end if;
  select price into tp from camp_tariffs where id = tid and camp_id = cid and active;
  if tp is null then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  if amt is not null and amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id, status into r, st from camp_participants where camp_id = cid and player_id = p;
  if r is not null and st = 'registered' then raise exception 'already registered' using errcode = '23505'; end if;
  if r is null then
    insert into camp_participants (camp_id, player_id, tariff_id, amount, tshirt_size, comment, status, registered_on)
    values (cid, p, tid, coalesce(amt, tp), nullif(trim(tshirt), ''), nullif(trim(cmt), ''), 'registered', current_date) returning id into r;
  else
    update camp_participants set tariff_id = tid, amount = coalesce(amt, tp), tshirt_size = nullif(trim(tshirt), ''), comment = nullif(trim(cmt), ''), status = 'registered' where id = r;
  end if;
  return r;
end $$;

create or replace function camp_update_participant(pid uuid, tid uuid, amt numeric, tshirt text, cmt text, st text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  perform camp_assert_admin();
  select camp_id into cid from camp_participants where id = pid;
  if cid is null then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if st not in ('registered', 'declined') then raise exception 'bad status' using errcode = '22023'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if tid is not null and not exists (select 1 from camp_tariffs where id = tid and camp_id = cid) then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  update camp_participants set tariff_id = coalesce(tid, tariff_id), amount = amt, tshirt_size = nullif(trim(tshirt), ''), comment = nullif(trim(cmt), ''), status = st where id = pid;
end $$;

create or replace function camp_pay(pid uuid, amt numeric, k text, d date, mth text, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cp camp_participants; r uuid;
begin
  perform camp_assert_admin();
  select * into cp from camp_participants where id = pid;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if k not in ('booking', 'payment') then raise exception 'bad kind' using errcode = '22023'; end if;
  if amt is null or amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, method, comment)
  values (cp.camp_id, pid, cp.player_id, amt, coalesce(d, current_date), k, nullif(trim(mth), ''), nullif(trim(cmt), '')) returning id into r;
  return r;
end $$;

-- Отмена платежа: строка с минусом, исходная остаётся. Повторно отменить нельзя.
create or replace function camp_cancel_payment(payid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p camp_payments; total numeric;
begin
  perform camp_assert_admin();
  select * into p from camp_payments where id = payid;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if p.kind = 'refund' or p.amount <= 0 then raise exception 'not cancellable' using errcode = '22023'; end if;
  if exists (select 1 from camp_payments where legacy_ref = 'cancel:' || payid) then raise exception 'already cancelled' using errcode = '23505'; end if;
  select coalesce(sum(amount), 0) into total from camp_payments where participant_id = p.participant_id;
  if total - p.amount < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, method, comment, legacy_ref)
  values (p.camp_id, p.participant_id, p.player_id, -p.amount, current_date, 'refund', p.method, 'Отмена платежа', 'cancel:' || payid);
end $$;

revoke execute on function camp_assert_admin() from public, anon, authenticated;
revoke execute on function camp_save(uuid, text, text, date, date, numeric, date, date, boolean), camp_tariff_save(uuid, text, numeric, boolean),
  camp_register(uuid, uuid, uuid, numeric, text, text), camp_update_participant(uuid, uuid, numeric, text, text, text),
  camp_pay(uuid, numeric, text, date, text, text), camp_cancel_payment(uuid) from public, anon;
grant execute on function camp_save(uuid, text, text, date, date, numeric, date, date, boolean), camp_tariff_save(uuid, text, numeric, boolean),
  camp_register(uuid, uuid, uuid, numeric, text, text), camp_update_participant(uuid, uuid, numeric, text, text, text),
  camp_pay(uuid, numeric, text, date, text, text), camp_cancel_payment(uuid) to authenticated;
