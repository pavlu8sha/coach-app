-- 0054: взносы за товарищеские и кубковые матчи (на матч, не на турнир): участники, оплата со способом и датой,
-- скидка, отмена. Тот же порядок, что у взносов события (0053), только для администратора.
-- Заодно исправление 0053: у импортированных взносов с paid = true нет строк оплат, их нельзя считать неоплаченными.

create or replace function tp_paid(t uuid, pid uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from tournament_payments p where p.tournament_id = t and p.player_id = pid)
      then (select sum(p.amount) from tournament_payments p where p.tournament_id = t and p.player_id = pid)
    else (select case when f.paid then f.amount else 0 end from tournament_fees f where f.tournament_id = t and f.player_id = pid)
  end
$$;
revoke execute on function tp_paid(uuid, uuid) from public, anon, authenticated;

create or replace function event_fee_recalc(t uuid, pid uuid) returns void
language sql security definer set search_path = public as $$
  update tournament_fees f set paid = f.amount > 0 and (select sum(p.amount) from tournament_payments p where p.tournament_id = t and p.player_id = pid) >= f.amount
   where f.tournament_id = t and f.player_id = pid
     and exists (select 1 from tournament_payments p where p.tournament_id = t and p.player_id = pid)
$$;

create or replace function event_fees(t uuid)
returns table (player_id uuid, full_name text, group_name text, due numeric, paid numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_admin();
  return query
    select f.player_id, p.full_name, g.name, f.amount, tp_paid(t, f.player_id)
      from tournament_fees f join players p on p.id = f.player_id left join groups g on g.id = p.group_id
     where f.tournament_id = t
     order by p.full_name;
end $$;

create or replace function event_pay(t uuid, ids uuid[], amt numeric, d date, mth text, cmt text) returns int
language plpgsql security definer set search_path = public as $$
declare pid uuid; f tournament_fees; a numeric; n int := 0;
begin
  perform event_assert_admin();
  if ids is null or cardinality(ids) = 0 or cardinality(ids) > 60 then raise exception 'bad selection' using errcode = '22023'; end if;
  if amt is not null and amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  foreach pid in array ids loop
    select * into f from tournament_fees where tournament_id = t and player_id = pid;
    if not found then raise exception 'player not in event' using errcode = 'P0002'; end if;
    a := coalesce(amt, f.amount - tp_paid(t, pid));
    if a > 0 then
      insert into tournament_payments (tournament_id, player_id, amount, paid_on, method, comment)
        values (t, pid, a, coalesce(d, current_date), nullif(trim(mth), ''), nullif(trim(cmt), ''));
      perform event_fee_recalc(t, pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Взнос события не меняется у уже оплативших (в том числе по импорту)
create or replace function event_set_fee(t uuid, amt numeric) returns void
language plpgsql security definer set search_path = public as $$
declare old numeric;
begin
  perform event_assert_admin();
  if amt is null or amt < 0 then raise exception 'invalid fee'; end if;
  select t0.fee into old from tournaments t0 where t0.id = t;
  if not found then raise exception 'event not found'; end if;
  update tournaments set fee = amt where id = t;
  update tournament_fees f set amount = amt
   where f.tournament_id = t and f.amount = old and not f.paid
     and not exists (select 1 from tournament_payments p where p.tournament_id = t and p.player_id = f.player_id);
end $$;

-- ===== взносы за матч =====
create table if not exists match_payments (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null,
  player_id uuid not null,
  amount numeric(10,2) not null,
  paid_on date not null,
  method text,
  comment text,
  cancels uuid unique references match_payments(id),
  created_at timestamptz not null default now(),
  foreign key (match_id, player_id) references match_fees(match_id, player_id) on delete cascade
);
create index if not exists match_payments_match_idx on match_payments (match_id, player_id);
alter table match_payments enable row level security;
drop policy if exists match_payments_admin on match_payments;
create policy match_payments_admin on match_payments for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on match_payments to authenticated, service_role;

create or replace function mp_paid(m uuid, pid uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from match_payments p where p.match_id = m and p.player_id = pid)
      then (select sum(p.amount) from match_payments p where p.match_id = m and p.player_id = pid)
    else (select case when f.paid then f.amount else 0 end from match_fees f where f.match_id = m and f.player_id = pid)
  end
$$;
revoke execute on function mp_paid(uuid, uuid) from public, anon, authenticated;

create or replace function match_fee_recalc(m uuid, pid uuid) returns void
language sql security definer set search_path = public as $$
  update match_fees f set paid = f.amount > 0 and (select sum(p.amount) from match_payments p where p.match_id = m and p.player_id = pid) >= f.amount
   where f.match_id = m and f.player_id = pid
     and exists (select 1 from match_payments p where p.match_id = m and p.player_id = pid)
$$;
revoke execute on function match_fee_recalc(uuid, uuid) from public, anon, authenticated;

create or replace function match_fees_list(m uuid)
returns table (player_id uuid, full_name text, group_name text, due numeric, paid numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_admin();
  return query
    select f.player_id, p.full_name, g.name, f.amount, mp_paid(m, f.player_id)
      from match_fees f join players p on p.id = f.player_id left join groups g on g.id = p.group_id
     where f.match_id = m
     order by p.full_name;
end $$;

create or replace function match_payments_list(m uuid)
returns table (id uuid, player_id uuid, full_name text, amount numeric, paid_on date, method text, comment text, cancelled boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform event_assert_admin();
  return query
    select x.id, x.player_id, p.full_name, x.amount, x.paid_on, x.method, x.comment,
           (x.cancels is not null or exists (select 1 from match_payments c where c.cancels = x.id))
      from match_payments x join players p on p.id = x.player_id
     where x.match_id = m
     order by x.paid_on desc, x.created_at desc;
end $$;

-- Добавить участников взноса за матч с суммой amt (повторно уже добавленных не трогает)
create or replace function match_fee_add(m uuid, ids uuid[], amt numeric) returns int
language plpgsql security definer set search_path = public as $$
declare mt matches; n int;
begin
  perform event_assert_admin();
  if amt is null or amt < 0 then raise exception 'invalid fee'; end if;
  select * into mt from matches where id = m;
  if mt.id is null then raise exception 'match not found'; end if;
  insert into match_fees (match_id, player_id, amount)
    select m, p.id, amt from players p where p.id = any (ids) and p.club_id = mt.club_id
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Новая сумма для всех, у кого нет оплат и скидки
create or replace function match_set_fee(m uuid, amt numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform event_assert_admin();
  if amt is null or amt < 0 then raise exception 'invalid fee'; end if;
  update match_fees f set amount = amt
   where f.match_id = m and not f.paid
     and not exists (select 1 from match_payments p where p.match_id = m and p.player_id = f.player_id);
end $$;

create or replace function match_fee_remove(m uuid, pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform event_assert_admin();
  if mp_paid(m, pid) > 0 or exists (select 1 from match_payments where match_id = m and player_id = pid) then
    raise exception 'fee already paid';
  end if;
  delete from match_fees where match_id = m and player_id = pid;
end $$;

create or replace function match_pay(m uuid, ids uuid[], amt numeric, d date, mth text, cmt text) returns int
language plpgsql security definer set search_path = public as $$
declare pid uuid; f match_fees; a numeric; n int := 0;
begin
  perform event_assert_admin();
  if ids is null or cardinality(ids) = 0 or cardinality(ids) > 60 then raise exception 'bad selection' using errcode = '22023'; end if;
  if amt is not null and amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  foreach pid in array ids loop
    select * into f from match_fees where match_id = m and player_id = pid;
    if not found then raise exception 'player not in match fees' using errcode = 'P0002'; end if;
    a := coalesce(amt, f.amount - mp_paid(m, pid));
    if a > 0 then
      insert into match_payments (match_id, player_id, amount, paid_on, method, comment)
        values (m, pid, a, coalesce(d, current_date), nullif(trim(mth), ''), nullif(trim(cmt), ''));
      perform match_fee_recalc(m, pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function match_discount(m uuid, pid uuid, due numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform event_assert_admin();
  if due is null or due < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  update match_fees set amount = due where match_id = m and player_id = pid;
  if not found then raise exception 'player not in match fees' using errcode = 'P0002'; end if;
  perform match_fee_recalc(m, pid);
end $$;

create or replace function match_cancel_payment(payid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p match_payments;
begin
  perform event_assert_admin();
  select * into p from match_payments where id = payid;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if p.amount <= 0 or p.cancels is not null or exists (select 1 from match_payments where cancels = payid) then
    raise exception 'not cancellable' using errcode = '22023';
  end if;
  insert into match_payments (match_id, player_id, amount, paid_on, comment, cancels)
    values (p.match_id, p.player_id, -p.amount, current_date, 'Отмена оплаты', payid);
  perform match_fee_recalc(p.match_id, p.player_id);
end $$;

revoke execute on function match_fees_list(uuid) from public, anon;
revoke execute on function match_payments_list(uuid) from public, anon;
revoke execute on function match_fee_add(uuid, uuid[], numeric) from public, anon;
revoke execute on function match_set_fee(uuid, numeric) from public, anon;
revoke execute on function match_fee_remove(uuid, uuid) from public, anon;
revoke execute on function match_pay(uuid, uuid[], numeric, date, text, text) from public, anon;
revoke execute on function match_discount(uuid, uuid, numeric) from public, anon;
revoke execute on function match_cancel_payment(uuid) from public, anon;
grant execute on function match_fees_list(uuid) to authenticated;
grant execute on function match_payments_list(uuid) to authenticated;
grant execute on function match_fee_add(uuid, uuid[], numeric) to authenticated;
grant execute on function match_set_fee(uuid, numeric) to authenticated;
grant execute on function match_fee_remove(uuid, uuid) to authenticated;
grant execute on function match_pay(uuid, uuid[], numeric, date, text, text) to authenticated;
grant execute on function match_discount(uuid, uuid, numeric) to authenticated;
grant execute on function match_cancel_payment(uuid) to authenticated;
