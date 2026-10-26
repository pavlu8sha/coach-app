-- Тренеры принимают взносы за товарищеские матчи (разовый взнос за игру). В чемпионате тренеры отмечают только посещаемость, взносы события у администратора.
-- Тренер: просмотр взносов и оплат матча, назначение суммы и участников, приём оплаты. Скидка, снятие взноса и отмена платежа остаются у администратора.
-- Матч «со взносом»: товарищеская игра, игра без турнира и игра кубка (как в экране матча); игры чемпионата и фестиваля тренеру закрыты.
create or replace function match_assert_fees(m uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if is_admin() then return; end if;
  if not is_any_coach() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (
    select 1 from matches x left join tournaments t on t.id = x.tournament_id
     where x.id = m and (x.kind = 'friendly' or t.id is null or t.kind = 'cup')
  ) then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;
revoke execute on function match_assert_fees(uuid) from public, anon, authenticated;

create or replace function match_fees_list(m uuid)
returns table (player_id uuid, full_name text, group_name text, due numeric, paid numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform match_assert_fees(m);
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
  perform match_assert_fees(m);
  return query
    select x.id, x.player_id, p.full_name, x.amount, x.paid_on, x.method, x.comment,
           (x.cancels is not null or exists (select 1 from match_payments c where c.cancels = x.id))
      from match_payments x join players p on p.id = x.player_id
     where x.match_id = m
     order by x.paid_on desc, x.created_at desc;
end $$;

create or replace function match_fee_add(m uuid, ids uuid[], amt numeric) returns int
language plpgsql security definer set search_path = public as $$
declare mt matches; n int;
begin
  perform match_assert_fees(m);
  if amt is null or amt < 0 then raise exception 'invalid fee'; end if;
  select * into mt from matches where id = m;
  if mt.id is null then raise exception 'match not found'; end if;
  insert into match_fees (match_id, player_id, amount)
    select m, p.id, amt from players p where p.id = any (ids) and p.club_id = mt.club_id
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function match_set_fee(m uuid, amt numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform match_assert_fees(m);
  if amt is null or amt < 0 then raise exception 'invalid fee'; end if;
  update match_fees f set amount = amt
   where f.match_id = m and not f.paid
     and not exists (select 1 from match_payments p where p.match_id = m and p.player_id = f.player_id);
end $$;

create or replace function match_pay(m uuid, ids uuid[], amt numeric, d date, mth text, cmt text) returns int
language plpgsql security definer set search_path = public as $$
declare pid uuid; f match_fees; a numeric; n int := 0;
begin
  perform match_assert_fees(m);
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
