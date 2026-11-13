-- Откат 0189 (#471 PR-2b): убирает строки opening_balance, созданные переносом остатков. Только владелец, только после выгрузки «до».
-- paid заказов не меняется (триггер 0188 строки opening_balance в paid не прибавлял), поэтому после отката paid снова больше журнала, как до 0189.
-- Строки журнала по 0179 только добавляются, поэтому удаление идёт при временно отключённых триггерах защиты; в конце проверка, что они включены.
-- Выполняется одной транзакцией.
do $$
declare v_n integer; v_sum numeric;
begin
  select count(*), coalesce(sum(amount), 0) into v_n, v_sum from service_payments where op = 'opening_balance';
  alter table service_payments disable trigger service_payments_history_guard;
  alter table service_payments disable trigger service_payments_history_audit;
  delete from service_payments where op = 'opening_balance';
  alter table service_payments enable trigger service_payments_history_guard;
  alter table service_payments enable trigger service_payments_history_audit;
  if exists (select 1 from pg_trigger where tgrelid = 'public.service_payments'::regclass and tgname in ('service_payments_history_guard', 'service_payments_history_audit') and tgenabled <> 'O') then
    raise exception 'rollback 0189: history triggers are not enabled';
  end if;
  raise notice 'rollback 0189: removed % opening_balance rows, total %', v_n, v_sum;
end $$;
