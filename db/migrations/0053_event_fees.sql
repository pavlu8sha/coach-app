-- 0053: взносы за события (чемпионат, фестиваль, кубок): оплаты со способом и датой, скидка, отмена оплаты.
-- Всё только для администратора; тренеры суммы не видят. Оплата хранится строками tournament_payments,
-- флаг tournament_fees.paid пересчитывается (сумма оплат >= сумма к оплате). Отмена платежа добавляет строку с минусом.

create table if not exists tournament_payments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null,
  player_id uuid not null,
  amount numeric(10,2) not null,
  paid_on date not null,
  method text,
  comment text,
  cancels uuid unique references tournament_payments(id),
  created_at timestamptz not null default now(),
  foreign key (tournament_id, player_id) references tournament_fees(tournament_id, player_id) on delete cascade
);
create index if not exists tournament_payments_event_idx on tournament_payments (tournament_id, player_id);
alter table tournament_payments enable row level security;
drop policy if exists tournament_payments_admin on tournament_payments;
create policy tournament_payments_admin on tournament_payments for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on tournament_payments to authenticated, service_role;

create or replace function event_assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function event_fee_recalc(t uuid, pid uuid) returns void
language sql security definer set search_path = public as $$
  update tournament_fees f set paid = f.amount > 0 and coalesce((select sum(p.amount) from tournament_payments p where p.tournament_id = t and p.player_id = pid), 0) >= f.amount
   where f.tournament_id = t and f.player_id = pid
$$;

-- Взнос события: меняет сумму у тех, кому не давали скидку и кто ещё не платил
create or replace function event_set_fee(t uuid, amt numeric) returns void
language plpgsql security definer set search_path = public as $$
declare old numeric; r record;
begin
  perform event_assert_admin();
  if amt is null or amt < 0 then raise exception 'invalid fee'; end if;
  select t0.fee into old from tournaments t0 where t0.id = t;
  if not found then raise exception 'event not found'; end if;
  update tournaments set fee = amt where id = t;
  update tournament_fees f set amount = amt
   where f.tournament_id = t and f.amount = old
     and not exists (select 1 from tournament_payments p where p.tournament_id = t and p.player_id = f.player_id);
  for r in select player_id from tournament_fees where tournament_id = t loop
    perform event_fee_recalc(t, r.player_id);
  end loop;
end $$;

create or replace function event_fees(t uuid)
returns table (player_id uuid, full_name text, group_name text, due numeric, paid numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_admin();
  return query
    select f.player_id, p.full_name, g.name, f.amount,
           coalesce((select sum(x.amount) from tournament_payments x where x.tournament_id = t and x.player_id = f.player_id), 0)
      from tournament_fees f join players p on p.id = f.player_id left join groups g on g.id = p.group_id
     where f.tournament_id = t
     order by p.full_name;
end $$;

create or replace function event_payments(t uuid)
returns table (id uuid, player_id uuid, full_name text, amount numeric, paid_on date, method text, comment text, cancelled boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_admin();
  return query
    select x.id, x.player_id, p.full_name, x.amount, x.paid_on, x.method, x.comment,
           (x.cancels is not null or exists (select 1 from tournament_payments c where c.cancels = x.id))
      from tournament_payments x join players p on p.id = x.player_id
     where x.tournament_id = t
     order by x.paid_on desc, x.created_at desc;
end $$;

-- Оплата: одному или нескольким (до 60); amt пустая — доплата остатка у каждого
create or replace function event_pay(t uuid, ids uuid[], amt numeric, d date, mth text, cmt text) returns int
language plpgsql security definer set search_path = public as $$
declare pid uuid; f tournament_fees; paid numeric; a numeric; n int := 0;
begin
  perform event_assert_admin();
  if ids is null or cardinality(ids) = 0 or cardinality(ids) > 60 then raise exception 'bad selection' using errcode = '22023'; end if;
  if amt is not null and amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  foreach pid in array ids loop
    select * into f from tournament_fees where tournament_id = t and player_id = pid;
    if not found then raise exception 'player not in event' using errcode = 'P0002'; end if;
    select coalesce(sum(x.amount), 0) into paid from tournament_payments x where x.tournament_id = t and x.player_id = pid;
    a := coalesce(amt, f.amount - paid);
    if a > 0 then
      insert into tournament_payments (tournament_id, player_id, amount, paid_on, method, comment)
        values (t, pid, a, coalesce(d, current_date), nullif(trim(mth), ''), nullif(trim(cmt), ''));
      perform event_fee_recalc(t, pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Скидка: новая сумма к оплате у игрока
create or replace function event_discount(t uuid, pid uuid, due numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform event_assert_admin();
  if due is null or due < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  update tournament_fees set amount = due where tournament_id = t and player_id = pid;
  if not found then raise exception 'player not in event' using errcode = 'P0002'; end if;
  perform event_fee_recalc(t, pid);
end $$;

create or replace function event_cancel_payment(payid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p tournament_payments;
begin
  perform event_assert_admin();
  select * into p from tournament_payments where id = payid;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if p.amount <= 0 or p.cancels is not null or exists (select 1 from tournament_payments where cancels = payid) then
    raise exception 'not cancellable' using errcode = '22023';
  end if;
  insert into tournament_payments (tournament_id, player_id, amount, paid_on, comment, cancels)
    values (p.tournament_id, p.player_id, -p.amount, current_date, 'Отмена оплаты', payid);
  perform event_fee_recalc(p.tournament_id, p.player_id);
end $$;

-- Убрать из состава нельзя, пока есть оплаты
create or replace function event_roster_remove(t uuid, pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform event_assert_staff();
  if exists (select 1 from tournament_payments where tournament_id = t and player_id = pid) then
    raise exception 'fee already paid';
  end if;
  delete from tournament_fees where tournament_id = t and player_id = pid;
end $$;

revoke execute on function event_assert_admin() from public, anon, authenticated;
revoke execute on function event_fee_recalc(uuid, uuid) from public, anon, authenticated;
revoke execute on function event_set_fee(uuid, numeric) from public, anon;
revoke execute on function event_fees(uuid) from public, anon;
revoke execute on function event_payments(uuid) from public, anon;
revoke execute on function event_pay(uuid, uuid[], numeric, date, text, text) from public, anon;
revoke execute on function event_discount(uuid, uuid, numeric) from public, anon;
revoke execute on function event_cancel_payment(uuid) from public, anon;
grant execute on function event_set_fee(uuid, numeric) to authenticated;
grant execute on function event_fees(uuid) to authenticated;
grant execute on function event_payments(uuid) to authenticated;
grant execute on function event_pay(uuid, uuid[], numeric, date, text, text) to authenticated;
grant execute on function event_discount(uuid, uuid, numeric) to authenticated;
grant execute on function event_cancel_payment(uuid) to authenticated;
