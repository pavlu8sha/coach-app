-- 0214 (#724, docs/acceptance/payment-idempotency-724-2026-11-20.md): платёж абонемента нельзя записать дважды при повторе запроса.
-- Если INSERT зафиксирован, а ответ потерян, повтор с тем же ключом возвращает уже записанный платёж, а не создаёт второй.
--  * payments.request_id: ключ операции, который задаёт клиент; старые строки остаются с null.
--  * уникальный индекс (recorded_by, request_id) where request_id is not null: защита на уровне PostgreSQL, как в 0188 у service_payments.
--  * payment_add(): запись через ключ; security invoker, права и RLS те же, что у прямого INSERT (пишет администратор).
-- Суммы, тарифы, расчёт долга, история и права на таблицу не меняются. request_id после записи не меняется (триггер 0179).

alter table payments add column if not exists request_id uuid;
create unique index if not exists payments_request_uq on payments (recorded_by, request_id) where request_id is not null;

create or replace function payment_add(req uuid, pid uuid, amt numeric, d date, mth text, fm date default null) returns jsonb
language plpgsql set search_path = public as $$
declare ex payments; newid uuid; a numeric(10,2);
begin
  if req is null then raise exception 'request id required' using errcode = '22023'; end if;
  if amt is null or round(amt, 2) = 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if d is null then raise exception 'bad date' using errcode = '22023'; end if;
  a := round(amt, 2);
  -- recorded_by ставит триггер stamp_payment_author из сессии; ключ принадлежит автору
  insert into payments (player_id, amount, paid_on, for_month, method, request_id)
  values (pid, a, d, fm, mth, req)
  on conflict (recorded_by, request_id) where request_id is not null do nothing
  returning id into newid;
  if newid is not null then
    return jsonb_build_object('id', newid, 'duplicate', false);
  end if;
  -- конфликт: параллельная или прежняя запись с этим ключом уже зафиксирована (при гонке ожидание шло на индексе до её коммита)
  select * into ex from payments where recorded_by = current_user_id() and request_id = req;
  if not found then raise exception 'request id conflict' using errcode = '40001'; end if;
  if ex.player_id = pid and ex.amount = a and ex.paid_on = d and ex.for_month is not distinct from fm and ex.method is not distinct from mth then
    return jsonb_build_object('id', ex.id, 'duplicate', true);
  end if;
  raise exception 'request id reused' using errcode = '22023';
end $$;

revoke execute on function payment_add(uuid, uuid, numeric, date, text, date) from public, anon;
grant execute on function payment_add(uuid, uuid, numeric, date, text, date) to authenticated;
