-- 0188 (#471 PR-2a): журнал оплат экипировки и защита. Условия: docs/acceptance/eq-471-pr2a-payment-journal-2026-11-13.md.
-- Требует 0179 (защита платежей) и 0185 (основа заказа). Перенос исторических остатков (opening_balance) — отдельная миграция 0189.
--  * service_payments: op (payment / reversal / refund / opening_balance), request_id, note; старые строки получают op по знаку суммы;
--  * paid заказа меняется только триггером на вставку в журнал; прямое изменение paid закрыто;
--  * eq_add_payment (идемпотентная, только плюс), eq_reverse_payment (сторно), eq_refund (возврат, в том числе после отмены);
--  * opening_balance приложение создать не может: права, триггер с признаком миграции, функции без op, тест-инвентарь;
--  * cash_report и cash_day_service не включают opening_balance;
--  * прямая запись в таблицы заказа закрыта у authenticated, политики for all заменены чтением.
-- Тела cash_report и cash_day_service пересобраны из определений текущего master (0110/0156 и позднее).

-- Вся миграция одной транзакцией: ошибка в любом месте откатывает всё, в том числе отключение триггеров защиты журнала.
begin;

-- 1. Поля журнала. Метка op старых строк ставится при временно отключённых триггерах 0179 (UPDATE метки иначе запрещён);
-- отключение и включение в одной транзакции, в конце проверка, что триггеры включены.
alter table service_payments
  add column if not exists op text,
  add column if not exists request_id uuid,
  add column if not exists note text;

alter table service_payments disable trigger service_payments_history_guard;
alter table service_payments disable trigger service_payments_history_audit;
do $$
declare n integer;
begin
  update service_payments set op = case when amount > 0 then 'payment' else 'reversal' end where op is null;
  get diagnostics n = row_count;
  -- одна сводная запись аудита о массовой классификации старых строк (по строке на платёж не пишем)
  insert into audit_log (actor_id, action, entity, entity_id, before, after)
  values (null, 'payment_op_backfill', 'service_payments', null, null, jsonb_build_object('migration', '0188', 'rows', n));
end $$;
alter table service_payments enable trigger service_payments_history_guard;
alter table service_payments enable trigger service_payments_history_audit;
do $$
begin
  if (select count(*) from pg_trigger where tgrelid = 'service_payments'::regclass and tgname in ('service_payments_history_guard', 'service_payments_history_audit') and tgenabled = 'O') <> 2 then
    raise exception '0188: триггеры защиты журнала не включены';
  end if;
end $$;
alter table service_payments alter column op set not null;

alter table service_payments drop constraint if exists service_payments_op_check;
alter table service_payments add constraint service_payments_op_check check (op in ('payment', 'reversal', 'refund', 'opening_balance'));
alter table service_payments drop constraint if exists service_payments_op_sign_check;
alter table service_payments add constraint service_payments_op_sign_check check (
  (op in ('payment', 'opening_balance') and amount > 0) or (op in ('reversal', 'refund') and amount < 0));
alter table service_payments drop constraint if exists service_payments_op_kind_check;
alter table service_payments add constraint service_payments_op_kind_check check (
  (op not in ('opening_balance', 'refund') or kind = 'equipment') and (op <> 'refund' or cancels is null));
create unique index if not exists service_payments_request_uq on service_payments (recorded_by, request_id) where request_id is not null;

-- 2. Вставка в журнал: вид операции выводится из суммы (клиент op не передаёт); opening_balance только миграцией.
create or replace function service_payments_insert_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.op is null then
    if new.amount > 0 then new.op := 'payment';
    elsif new.cancels is not null then new.op := 'reversal';
    else raise exception 'negative payment needs cancels or eq_refund' using errcode = '22023';
    end if;
  end if;
  if new.op = 'opening_balance' and (coalesce(current_setting('eq.backfill_gate', true), '') <> 'on' or new.recorded_by is not null) then
    raise exception 'opening_balance is created only by migration' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function service_payments_insert_guard() from public, anon, authenticated;
drop trigger if exists service_payments_insert_guard on service_payments;
create trigger service_payments_insert_guard before insert on service_payments for each row execute function service_payments_insert_guard();

-- 3. Кэш paid: только через журнал (добавляется сумма строки; opening_balance уже внутри paid).
create or replace function eq_paid_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'equipment' or new.op = 'opening_balance' then return null; end if;
  perform set_config('eq.paid_sync', 'on', true);
  update equipment_orders set paid = paid + new.amount where id = new.ref_id;
  perform set_config('eq.paid_sync', '', true);
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  return null;
end $$;
revoke execute on function eq_paid_sync() from public, anon, authenticated;
drop trigger if exists service_payments_paid_sync on service_payments;
create trigger service_payments_paid_sync after insert on service_payments for each row execute function eq_paid_sync();

-- Защита заказа (0185) + paid: прямая запись закрыта, ниже нуля нельзя.
create or replace function eq_orders_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  op text := coalesce(current_setting('eq.op', true), '');
begin
  if tg_op = 'INSERT' then
    new.created_by := current_user_id();
    if new.created_by is not null then new.created_at := now(); end if;
    if new.external_ord_id is not null and new.source = 'admin' then new.source := 'import'; end if;
    if new.status = 'cancelled' or new.cancelled_at is not null or new.status_before_cancel is not null then
      raise exception 'use eq_cancel_order / eq_restore_order' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by
     or new.source is distinct from old.source or new.request_id is distinct from old.request_id then
    raise exception 'created fields are immutable' using errcode = '42501';
  end if;
  if op not in ('cancel', 'restore') and (
       (new.status = 'cancelled') <> (old.status = 'cancelled')
       or new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by
       or new.cancel_reason is distinct from old.cancel_reason or new.status_before_cancel is distinct from old.status_before_cancel
       or new.restored_at is distinct from old.restored_at or new.restored_by is distinct from old.restored_by) then
    raise exception 'use eq_cancel_order / eq_restore_order' using errcode = '42501';
  end if;
  if old.status = 'cancelled' and new.status = 'cancelled' then
    if new.paid > old.paid or (to_jsonb(new) - 'paid') is distinct from (to_jsonb(old) - 'paid') then
      raise exception 'order cancelled' using errcode = '22023';
    end if;
  end if;
  if new.paid is distinct from old.paid then
    if coalesce(current_setting('eq.paid_sync', true), '') <> 'on' then
      raise exception 'paid is maintained by the journal' using errcode = '42501';
    end if;
    if new.paid < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
revoke execute on function eq_orders_guard() from public, anon, authenticated;

-- 4. Оплата: только плюс, идемпотентность по ключу (автор + request_id). Тело 0157 + отмена, ключ, кэш через журнал.
drop function if exists eq_add_payment(uuid, numeric, date, text);
create or replace function eq_add_payment(o uuid, amt numeric, d date default null, mth text default null, req uuid default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; ex service_payments; uid uuid := current_user_id();
begin
  if not (is_admin() or has_location_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not is_admin() and not is_location_admin(eo.location) then raise exception 'forbidden' using errcode = '42501'; end if;
  if amt is null or amt = 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if amt < 0 then raise exception 'use reversal or refund' using errcode = '22023'; end if;
  if req is not null then
    select * into ex from service_payments where recorded_by = uid and request_id = req;
    if found then
      if ex.kind = 'equipment' and ex.ref_id = o and ex.amount = amt and ex.op = 'payment' then return eo.paid; end if;
      raise exception 'request id reused' using errcode = '22023';
    end if;
  end if;
  if eo.status = 'cancelled' then raise exception 'order cancelled' using errcode = '22023'; end if;
  if d is not null and d > tbilisi_day(now()) then raise exception 'bad date' using errcode = '22023'; end if;
  perform service_method_ok(mth);
  if eo.paid + amt > eo.total then raise exception 'paid above total' using errcode = '22023'; end if;
  insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, request_id)
  values ('equipment', o, eo.player_id, amt, coalesce(d, tbilisi_day(now())), trim(mth), 'payment', req);
  return (select paid from equipment_orders where id = o);
end $$;

-- 5. Сторно: одна оплата — одно сторно, только глобальный администратор.
create or replace function eq_reverse_payment(pid uuid, note text, req uuid default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare orig service_payments; eo equipment_orders; ex service_payments; uid uuid := current_user_id();
begin
  perform eq_assert_admin();
  select * into orig from service_payments where id = pid;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if orig.kind <> 'equipment' or orig.op <> 'payment' then raise exception 'not a payment' using errcode = '22023'; end if;
  select * into eo from equipment_orders where id = orig.ref_id for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if req is not null then
    select * into ex from service_payments where recorded_by = uid and request_id = req;
    if found then
      if ex.cancels = pid then return eo.paid; end if;
      raise exception 'request id reused' using errcode = '22023';
    end if;
  end if;
  if nullif(trim(note), '') is null then raise exception 'note required' using errcode = '22023'; end if;
  if exists (select 1 from service_payments where cancels = pid) then raise exception 'already reversed' using errcode = '22023'; end if;
  if eo.paid - orig.amount < 0 then raise exception 'paid below zero' using errcode = '22023'; end if;
  insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, cancels, op, note, request_id)
  values ('equipment', orig.ref_id, orig.player_id, -orig.amount, tbilisi_day(now()), orig.method, pid, 'reversal', trim(note), req);
  return (select paid from equipment_orders where id = orig.ref_id);
end $$;

-- 6. Возврат денег: только глобальный администратор, не больше оплаченного, причина обязательна; итог и статус не меняются.
create or replace function eq_refund(o uuid, amt numeric, d date default null, mth text default null, note text default null, req uuid default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare eo equipment_orders; ex service_payments; uid uuid := current_user_id();
begin
  perform eq_assert_admin();
  select * into eo from equipment_orders where id = o for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if amt is null or amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if req is not null then
    select * into ex from service_payments where recorded_by = uid and request_id = req;
    if found then
      if ex.kind = 'equipment' and ex.ref_id = o and ex.amount = -amt and ex.op = 'refund' then return eo.paid; end if;
      raise exception 'request id reused' using errcode = '22023';
    end if;
  end if;
  if nullif(trim(note), '') is null then raise exception 'note required' using errcode = '22023'; end if;
  if d is not null and d > tbilisi_day(now()) then raise exception 'bad date' using errcode = '22023'; end if;
  perform service_method_ok(mth);
  if amt > eo.paid then raise exception 'refund above paid' using errcode = '22023'; end if;
  insert into service_payments (kind, ref_id, player_id, amount, paid_on, method, op, note, request_id)
  values ('equipment', o, eo.player_id, -amt, coalesce(d, tbilisi_day(now())), trim(mth), 'refund', trim(note), req);
  return (select paid from equipment_orders where id = o);
end $$;

revoke execute on function eq_add_payment(uuid, numeric, date, text, uuid), eq_reverse_payment(uuid, text, uuid),
  eq_refund(uuid, numeric, date, text, text, uuid) from public, anon;
grant execute on function eq_add_payment(uuid, numeric, date, text, uuid), eq_reverse_payment(uuid, text, uuid),
  eq_refund(uuid, numeric, date, text, text, uuid) to authenticated;

-- 7. Права: журнал пишут только функции и владелец; таблицы заказа закрыты для прямой записи.
revoke insert, update, delete, truncate on service_payments from anon, authenticated, service_role;
revoke insert, update, delete, truncate on equipment_orders, equipment_order_lines, equipment_issues, equipment_order_status_history from anon, authenticated;
drop policy if exists equipment_orders_admin on equipment_orders;
drop policy if exists equipment_lines_admin on equipment_order_lines;
drop policy if exists equipment_issues_admin on equipment_issues;
drop policy if exists equipment_issues_admin_read on equipment_issues;
create policy equipment_issues_admin_read on equipment_issues for select using (is_admin());
-- Журнал оплат экипировки: локальный администратор читает только заказы своих локаций (прямой записи у него нет, как и у остальных).
drop policy if exists service_payments_eq_local_admin_read on service_payments;
create policy service_payments_eq_local_admin_read on service_payments for select to authenticated
  using (kind = 'equipment' and exists (select 1 from equipment_orders o where o.id = service_payments.ref_id and is_location_admin(o.location)));

-- 8. Кассовые отчёты без opening_balance (тела из текущего master).
CREATE OR REPLACE FUNCTION public.cash_report(p_from date, p_to date, p_location text DEFAULT NULL::text, p_staff uuid DEFAULT NULL::uuid, p_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare res jsonb;
begin
  if not is_admin() and not has_location_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad period' using errcode = '22023'; end if;

  with src as (
    select 'Абонемент' as kind, p.id, p.player_id, p.amount, p.paid_on, p.method, p.recorded_by, p.recorded_at, gr.location as location
      from payments p join players pl on pl.id = p.player_id left join groups gr on gr.id = pl.group_id
    union all
    select 'Сбор', c.id, c.player_id, c.amount, c.paid_on, c.method, c.recorded_by, c.recorded_at, cm.location
      from camp_payments c left join camps cm on cm.id = c.camp_id
    union all
    select 'Взнос матча', m.id, m.player_id, m.amount, m.paid_on, m.method, m.recorded_by, m.recorded_at, null
      from match_payments m
    union all
    select 'Взнос события', t.id, t.player_id, t.amount, t.paid_on, t.method, t.recorded_by, t.recorded_at, null
      from tournament_payments t
    union all
    select case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' when 'visit' then 'Разовое посещение' else 'Доп. занятие' end,
           sp.id, sp.player_id, sp.amount, sp.paid_on, sp.method, sp.recorded_by, sp.recorded_at,
           case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                        when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id)
                        when 'visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id) end
      from service_payments sp
     where sp.op <> 'opening_balance' -- 0188: остатки до начала учёта не деньги периода
  ), rows_f as (
    select s.*, case when s.method in ('Наличные', 'Перевод') then s.method else 'не указан' end as method_key
      from src s
     where s.paid_on between p_from and p_to
       and (p_location is null or s.location = p_location)
       and (p_staff is null or s.recorded_by = p_staff)
       and (is_admin() or (s.recorded_by = current_user_id()
                           and s.location in (select la.location from location_admins la where la.user_id = current_user_id())))
  ), rows_m as (
    select * from rows_f where p_method is null or method_key = p_method
  )
  select jsonb_build_object(
    'total', coalesce((select sum(amount) from rows_m), 0),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method_key, 'sum', sm) order by method_key)
                             from (select method_key, sum(amount) sm from rows_m group by method_key) x), '[]'::jsonb),
    'by_staff', coalesce((select jsonb_agg(jsonb_build_object('staff_id', staff_id, 'name', staff_name, 'sum', sm) order by staff_name)
                            from (select r.recorded_by as staff_id, coalesce(u.display_name, 'не указан') as staff_name, sum(r.amount) sm
                                    from rows_m r left join users u on u.id = r.recorded_by
                                   group by r.recorded_by, u.display_name) x), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', r.id, 'kind', r.kind, 'player', pl.full_name, 'amount', r.amount, 'paid_on', r.paid_on,
                        'method', r.method_key, 'staff', coalesce(u.display_name, 'не указан'), 'recorded_at', r.recorded_at,
                        'location', r.location)
                       order by r.paid_on, r.recorded_at nulls last, r.id)
                     from rows_m r join players pl on pl.id = r.player_id left join users u on u.id = r.recorded_by), '[]'::jsonb)
  ) into res;
  return res;
end $function$;

CREATE OR REPLACE FUNCTION public.cash_day_service(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() and not has_location_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'method', x.method, 'what', x.what,
                                        'player_id', x.player_id, 'full_name', x.full_name, 'recorded_at', x.recorded_at,
                                        'detail', x.detail)
                     order by x.recorded_at nulls last, x.id)
      from (
        select sp.id, sp.amount, sp.method, sp.player_id, pl.full_name, sp.recorded_at,
               case sp.kind when 'equipment' then 'Экипировка' when 'individual' then 'Индивидуальное' when 'visit' then 'Разовое посещение' else 'Доп. занятие' end as what,
               case sp.kind when 'equipment' then (select eo.location from equipment_orders eo where eo.id = sp.ref_id)
                            when 'extra' then (select es.place from extra_sessions es where es.id = sp.ref_id)
                            when 'visit' then (select vg.location from sessions vs join groups vg on vg.id = vs.group_id where vs.id = sp.ref_id) end as loc,
               null::text as detail
          from service_payments sp join players pl on pl.id = sp.player_id
         where sp.paid_on = p_day and sp.op <> 'opening_balance' -- 0188: остатки до начала учёта не деньги дня
        union all
        select mp.id, mp.amount, mp.method, mp.player_id, pl.full_name, mp.recorded_at,
               'Взнос матча', null::text,
               concat_ws(' ', to_char(m.played_on, 'DD.MM'), nullif(m.opponent, ''))
          from match_payments mp join players pl on pl.id = mp.player_id join matches m on m.id = mp.match_id
         where mp.paid_on = p_day
        union all
        select tp.id, tp.amount, tp.method, tp.player_id, pl.full_name, tp.recorded_at,
               'Взнос события', null::text, t.name
          from tournament_payments tp join players pl on pl.id = tp.player_id join tournaments t on t.id = tp.tournament_id
         where tp.paid_on = p_day
      ) x
     where is_admin() or x.loc in (select la.location from location_admins la where la.user_id = current_user_id())
  ), '[]'::jsonb);
end $function$;

commit;
