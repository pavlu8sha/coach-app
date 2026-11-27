-- 0231 (#721, docs/acceptance/camp-refund-idempotency-721-2026-11-27.md): возврат за сбор нельзя записать дважды при повторе запроса.
-- Если возврат зафиксирован, а ответ потерян, повтор с тем же ключом возвращает уже записанный возврат, а не создаёт второй.
--  * camp_payments.request_id: ключ операции, который задаёт клиент; старые строки остаются с null.
--  * уникальный индекс (recorded_by, request_id) where request_id is not null: защита на уровне PostgreSQL (как payments_request_uq в 0214).
--  * camp_refund(pid, amt, d, cmt, req default null) возвращает jsonb {id, duplicate} (раньше uuid). Прежняя четырёхаргументная функция
--    удаляется: вызов без ключа остаётся возможным (req = null, поведение как до миграции), чтобы прежний интерфейс работал до деплоя.
-- Правила возврата (сумма > 0, дата не в будущем, не больше оплаченного, только администратор), блокировки сбор → участник, права и RLS не меняются.
-- Тело берётся из 0166 (единственное определение: grep -lEi "function +(public\.)?camp_refund *\(" db/migrations/*.sql).

alter table camp_payments add column if not exists request_id uuid;
create unique index if not exists camp_payments_request_uq on camp_payments (recorded_by, request_id) where request_id is not null;

drop function if exists camp_refund(uuid, numeric, date, text);

create or replace function camp_refund(pid uuid, amt numeric, d date, cmt text, req uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cp camp_participants; paid numeric; r uuid; ex camp_payments; c text := nullif(btrim(cmt), '');
begin
  perform camp_assert_admin();
  -- порядок блокировок как у остальных функций сборов: сначала сбор, потом участник (иначе взаимная блокировка)
  perform 1 from camps where id = (select camp_id from camp_participants where id = pid) for update;
  select * into cp from camp_participants where id = pid for update;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  -- повтор: запись с этим ключом уже есть. Проверяется до остальных правил: повтор возврата всего остатка не должен падать на «refund above paid».
  if req is not null then
    select * into ex from camp_payments where recorded_by = current_user_id() and request_id = req;
    if found then
      if ex.kind = 'refund' and ex.participant_id = pid and ex.amount = -round(amt, 2) and ex.comment is not distinct from c
         and (d is null or ex.paid_on = d) then
        return jsonb_build_object('id', ex.id, 'duplicate', true);
      end if;
      raise exception 'request id reused' using errcode = '22023';
    end if;
  end if;
  if amt is null or amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if d is not null and d > (now() at time zone 'Asia/Tbilisi')::date then raise exception 'bad date' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into paid from camp_payments where participant_id = pid;
  if amt > paid then raise exception 'refund above paid' using errcode = '22023'; end if;
  -- recorded_by ставит триггер stamp_payment_author из сессии; ключ принадлежит автору
  insert into camp_payments (camp_id, participant_id, player_id, amount, paid_on, kind, comment, request_id)
  values (cp.camp_id, pid, cp.player_id, -amt, coalesce(d, current_date), 'refund', c, req)
  on conflict (recorded_by, request_id) where request_id is not null do nothing
  returning id into r;
  if r is not null then
    return jsonb_build_object('id', r, 'duplicate', false);
  end if;
  -- конфликт на индексе (страховка: обычно блокировки выше уже сериализуют запросы по участнику и сбору)
  select * into ex from camp_payments where recorded_by = current_user_id() and request_id = req;
  if not found then raise exception 'request id conflict' using errcode = '40001'; end if;
  if ex.kind = 'refund' and ex.participant_id = pid and ex.amount = -round(amt, 2) and ex.comment is not distinct from c and (d is null or ex.paid_on = d) then
    return jsonb_build_object('id', ex.id, 'duplicate', true);
  end if;
  raise exception 'request id reused' using errcode = '22023';
end $$;

revoke execute on function camp_refund(uuid, numeric, date, text, uuid) from public, anon;
grant execute on function camp_refund(uuid, numeric, date, text, uuid) to authenticated;
