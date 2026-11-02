-- 0097 (#247): отмена оплаты абонемента ссылается на исходный платёж по id.
-- Раньше отмена (запись с минусом) искалась по игроку, дню и сумме: при двух одинаковых платежах в один день
-- нельзя было понять, какой из них отменён. Как в service_payments и match_payments, добавляем cancels со ссылкой на оригинал.
-- unique: один платёж отменяется не больше одного раза (повторная и параллельная отмена получают ошибку 23505).
-- Старые отмены (импорт, корректировки) остаются без ссылки: их проверка ниже не касается.

alter table payments add column if not exists cancels uuid unique references payments(id);

-- Отмена с ссылкой допустима только для положительного платежа того же игрока на ту же сумму с минусом.
-- Месяц и абонемент берутся от оригинала, чтобы отмена гасила платёж именно в его месяце.
create or replace function payments_check_cancel() returns trigger
language plpgsql set search_path = public as $$
declare o payments;
begin
  if new.cancels is null then return new; end if;
  select * into o from payments where id = new.cancels;
  if not found then raise exception 'cancelled payment not found' using errcode = '22023'; end if;
  if o.amount <= 0 or o.player_id <> new.player_id or new.amount <> -o.amount then
    raise exception 'bad cancel' using errcode = '22023';
  end if;
  new.for_month := o.pay_month;
  new.subscription_id := coalesce(new.subscription_id, o.subscription_id);
  return new;
end $$;

drop trigger if exists payments_check_cancel on payments;
create trigger payments_check_cancel before insert on payments for each row execute function payments_check_cancel();
