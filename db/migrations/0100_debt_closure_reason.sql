-- #260: закрытие месяца без поступления денег (скидка, долг прощён, оплачено вне приложения) должно иметь вид, причину, автора и дату.
-- Деньги по-прежнему только в payments; флаги discount и written_off остаются как есть (долги и отчёты их уже учитывают),
-- к ним добавляются поля аудита. Выручку и кассу флаги не меняют и не меняли.
alter table subscriptions add column if not exists closed_kind text check (closed_kind in ('discount', 'forgiven', 'paid_elsewhere'));
alter table subscriptions add column if not exists closed_reason text;
alter table subscriptions add column if not exists closed_by uuid references users(id);
alter table subscriptions add column if not exists closed_at timestamptz;

-- Прошлые закрытия: вид по флагу, причина «до 02.11.2026» (настоящей причины в данных нет).
update subscriptions
set closed_kind = case when written_off then 'forgiven' else 'discount' end,
    closed_reason = 'до 02.11.2026',
    closed_at = coalesce(closed_at, now())
where (discount or written_off) and closed_kind is null;

create or replace function subscriptions_closure_audit() returns trigger
language plpgsql as $$
declare was_closed boolean := tg_op = 'UPDATE' and (old.discount or old.written_off);
begin
  if new.discount or new.written_off then
    if not was_closed then
      if new.closed_kind is null or length(trim(coalesce(new.closed_reason, ''))) < 3 then
        raise exception 'closure needs kind and reason' using errcode = '22023';
      end if;
      new.closed_reason := trim(new.closed_reason);
      new.closed_by := current_user_id();
      new.closed_at := now();
    else
      -- уже закрытый месяц: вид, причину, автора и дату не подменяем
      new.closed_kind := old.closed_kind;
      new.closed_reason := old.closed_reason;
      new.closed_by := old.closed_by;
      new.closed_at := old.closed_at;
    end if;
  else
    new.closed_kind := null;
    new.closed_reason := null;
    new.closed_by := null;
    new.closed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists subscriptions_closure_audit on subscriptions;
create trigger subscriptions_closure_audit before insert or update on subscriptions
  for each row execute function subscriptions_closure_audit();
