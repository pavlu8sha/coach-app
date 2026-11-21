-- 0216 (docs/acceptance/payment-set-method-0216-2026-11-20.md): исправление способа оплаты абонемента (Наличные ↔ Перевод) через функцию.
-- У роли authenticated на payments отозвано право UPDATE (0004), поэтому прямая правка из приложения невозможна; права на таблицу не меняются.
--  * payment_set_method(pid, new_method, old_method): security definer, только администратор, только положительный неотменённый платёж, только поле method;
--    old_method защищает от параллельной правки; запись попадает в audit_log триггером 0179 (payment_correct), без триггера функция отказывает.
-- Суммы, даты, расчёт долга и история платежей не меняются. Откат: db/ops/rollback-0216-payment-set-method.sql. Применять в SQL Editor целиком, сначала db/ops/preflight.sql (нужна 0179).
create or replace function payment_set_method(pid uuid, new_method text, old_method text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p payments;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if new_method is null or new_method not in ('Наличные', 'Перевод') or old_method is null or old_method not in ('Наличные', 'Перевод') then
    raise exception 'bad method' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.payments'::regclass and tgname = 'payments_history_audit' and tgenabled <> 'D') then
    raise exception 'payment history audit not installed' using errcode = '55000';
  end if;
  select * into p from payments where id = pid for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if p.amount <= 0 or p.cancels is not null then raise exception 'not a payment' using errcode = '22023'; end if;
  if exists (select 1 from payments c where c.cancels = pid) then raise exception 'payment cancelled' using errcode = '22023'; end if;
  if p.method is distinct from old_method then raise exception 'payment changed' using errcode = '40001'; end if;
  if p.method = new_method then return jsonb_build_object('id', pid, 'changed', false); end if;
  update payments set method = new_method where id = pid;
  return jsonb_build_object('id', pid, 'changed', true);
end $$;
revoke execute on function payment_set_method(uuid, text, text) from public, anon;
grant execute on function payment_set_method(uuid, text, text) to authenticated;
