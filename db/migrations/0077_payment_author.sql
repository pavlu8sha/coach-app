-- 0077 (#264): автор и время записи платежа. Автор ставит сервер по сессии, а не клиент.
-- Все четыре журнала платежей: payments (абонемент), camp_payments (сборы), match_payments (взносы матчей),
-- tournament_payments (взносы событий). Для строк, записанных без пользователя (импорт через service role),
-- recorded_by и recorded_at остаются как есть: там их нет, и они не выдумываются.
-- Автор и время после записи не меняются.

alter table payments add column if not exists recorded_by uuid references users(id);
alter table payments add column if not exists recorded_at timestamptz;
alter table camp_payments add column if not exists recorded_by uuid references users(id);
alter table camp_payments add column if not exists recorded_at timestamptz;
alter table match_payments add column if not exists recorded_by uuid references users(id);
alter table match_payments add column if not exists recorded_at timestamptz;
alter table tournament_payments add column if not exists recorded_by uuid references users(id);
alter table tournament_payments add column if not exists recorded_at timestamptz;

-- Вставка от вошедшего пользователя: автор и время берутся из сессии, любое значение клиента заменяется.
create or replace function stamp_payment_author() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user_id() is not null then
    new.recorded_by := current_user_id();
    new.recorded_at := now();
  end if;
  return new;
end $$;

-- После записи автор и время не меняются (журнал только добавляется).
create or replace function guard_payment_author() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.recorded_by is distinct from old.recorded_by or new.recorded_at is distinct from old.recorded_at then
    raise exception 'payment author is fixed' using errcode = '42501';
  end if;
  return new;
end $$;

revoke execute on function stamp_payment_author(), guard_payment_author() from public, anon, authenticated;

drop trigger if exists payments_stamp_author on payments;
create trigger payments_stamp_author before insert on payments for each row execute function stamp_payment_author();
drop trigger if exists payments_guard_author on payments;
create trigger payments_guard_author before update on payments for each row execute function guard_payment_author();

drop trigger if exists camp_payments_stamp_author on camp_payments;
create trigger camp_payments_stamp_author before insert on camp_payments for each row execute function stamp_payment_author();
drop trigger if exists camp_payments_guard_author on camp_payments;
create trigger camp_payments_guard_author before update on camp_payments for each row execute function guard_payment_author();

drop trigger if exists match_payments_stamp_author on match_payments;
create trigger match_payments_stamp_author before insert on match_payments for each row execute function stamp_payment_author();
drop trigger if exists match_payments_guard_author on match_payments;
create trigger match_payments_guard_author before update on match_payments for each row execute function guard_payment_author();

drop trigger if exists tournament_payments_stamp_author on tournament_payments;
create trigger tournament_payments_stamp_author before insert on tournament_payments for each row execute function stamp_payment_author();
drop trigger if exists tournament_payments_guard_author on tournament_payments;
create trigger tournament_payments_guard_author before update on tournament_payments for each row execute function guard_payment_author();
