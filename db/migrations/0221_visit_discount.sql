-- 0221 (docs/VISIT_DISCOUNT_ACCEPTANCE.md): скидка на доп. посещение чужой группы и закрытие без оплаты.
-- Просьба Павла 23.11.2026: «по аналогии с закрытием без оплаты» у абонементов, взносов матчей и событий (0100, 0109): причина обязательна, автор и время сохраняются.
--  * session_guest_discount(s, p, due, why): security definer, только глобальный администратор; только неоплаченное посещение;
--    due > 0 уменьшает сумму посещения и оставляет его неоплаченным; due = 0 закрывает посещение без оплаты (paid = true, paid_amount = 0, сумма amount не меняется, без записи в service_payments);
--    увеличить сумму этой функцией нельзя (due больше текущей суммы: bad amount); закрытие без оплаты отменяется обычной отменой оплаты, долг возвращается в прежней сумме;
--  * каждое изменение пишется в fee_discount_log (вид 'visit', ref_id = занятие); прежняя сумма и причина сохраняются.
-- Деньги, касса и баллы не меняются. Откат: db/ops/rollback-0221-visit-discount.sql. Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.fee_discount_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%';
  if c is not null then execute format('alter table fee_discount_log drop constraint %I', c); end if;
end $$;
alter table fee_discount_log add constraint fee_discount_log_kind_check check (kind in ('event', 'match', 'visit'));

create or replace function session_guest_discount(s uuid, p uuid, due numeric, why text) returns void
language plpgsql security definer set search_path = public as $$
declare g session_guests;
begin
  if current_user_id() is null or not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if due is null or due < 0 or due > 100000 then raise exception 'bad amount' using errcode = '22023'; end if;
  if length(trim(coalesce(why, ''))) < 3 then raise exception 'discount needs reason' using errcode = '22023'; end if;
  select * into g from session_guests where session_id = s and player_id = p for update;
  if not found then raise exception 'guest not found' using errcode = 'P0002'; end if;
  if g.paid then raise exception 'visit paid' using errcode = '22023'; end if;
  if due > g.amount then raise exception 'bad amount' using errcode = '22023'; end if;
  if g.amount = due then return; end if;
  insert into fee_discount_log (kind, ref_id, player_id, old_amount, new_amount, reason, created_by)
    values ('visit', s, p, g.amount, due, trim(why), current_user_id());
  if due = 0 then
    update session_guests set paid = true, paid_amount = 0, method = null where session_id = s and player_id = p;
  else
    update session_guests set amount = due where session_id = s and player_id = p;
  end if;
end $$;
revoke execute on function session_guest_discount(uuid, uuid, numeric, text) from public, anon;
grant execute on function session_guest_discount(uuid, uuid, numeric, text) to authenticated;

commit;
