-- Откат 0231 (#721): вернуть camp_refund(uuid, numeric, date, text) → uuid (тело 0166, но с закреплением search_path = public, pg_temp: откат не возвращает прежнюю небезопасную конфигурацию), убрать индекс и столбец request_id.
-- Платежи и возвраты не затрагиваются. Перед откатом выложить версию интерфейса, которая не передаёт ключ req и не читает {id, duplicate}
-- (прежний интерфейс вызывает функцию без req и результат не читает). Ключи операций будут потеряны.
-- Триггер 0165 запрещает изменение строк, но не структуры; drop column выполняет владелец в SQL Editor.
drop function if exists camp_refund(uuid, numeric, date, text, uuid);
create or replace function camp_refund(pid uuid, amt numeric, d date, cmt text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare cp camp_participants; paid numeric; r uuid;
begin
  perform camp_assert_admin();
  perform 1 from camps where id = (select camp_id from camp_participants where id = pid) for update;
  select * into cp from camp_participants where id = pid for update;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if amt is null or amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if d is not null and d > (now() at time zone 'Asia/Tbilisi')::date then raise exception 'bad date' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into paid from camp_payments where participant_id = pid;
  if amt > paid then raise exception 'refund above paid' using errcode = '22023'; end if;
  insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, comment)
  values (cp.camp_id, pid, cp.player_id, -amt, coalesce(d, current_date), 'refund', nullif(btrim(cmt), ''))
  returning id into r;
  return r;
end $$;
revoke execute on function camp_refund(uuid, numeric, date, text) from public, anon;
grant execute on function camp_refund(uuid, numeric, date, text) to authenticated;
drop index if exists camp_payments_request_uq;
alter table camp_payments drop column if exists request_id;
