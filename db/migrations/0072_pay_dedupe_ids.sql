-- 0072 (D-04): повтор player_id в массиве оплаты (array[p, p]) давал две оплаты. Теперь id дедуплицируются,
-- оплата проводится один раз на игрока (возвращаемое число — число уникальных игроков). Остальное — как в 0071.

create or replace function event_pay(t uuid, ids uuid[], amt numeric, d date, mth text, cmt text) returns int
language plpgsql security definer set search_path = public as $$
declare uids uuid[]; pid uuid; f tournament_fees; a numeric; n int := 0;
begin
  perform event_assert_admin();
  if ids is null or cardinality(ids) = 0 or cardinality(ids) > 60 then raise exception 'bad selection' using errcode = '22023'; end if;
  if amt is not null and amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct x), '{}') into uids from unnest(ids) x;
  foreach pid in array uids loop
    select * into f from tournament_fees where tournament_id = t and player_id = pid;
    if not found then raise exception 'player not in event' using errcode = 'P0002'; end if;
    a := coalesce(amt, f.amount - tp_paid(t, pid));
    if a > 0 then
      if f.paid and f.amount > 0 and not exists (select 1 from tournament_payments x where x.tournament_id = t and x.player_id = pid) then
        insert into tournament_payments (tournament_id, player_id, amount, paid_on, method, comment)
          values (t, pid, f.amount, current_date, 'import', 'Оплата из импорта');
      end if;
      insert into tournament_payments (tournament_id, player_id, amount, paid_on, method, comment)
        values (t, pid, a, coalesce(d, current_date), nullif(trim(mth), ''), nullif(trim(cmt), ''));
      perform event_fee_recalc(t, pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function match_pay(m uuid, ids uuid[], amt numeric, d date, mth text, cmt text) returns int
language plpgsql security definer set search_path = public as $$
declare uids uuid[]; pid uuid; f match_fees; a numeric; n int := 0;
begin
  perform match_assert_fees(m);
  if ids is null or cardinality(ids) = 0 or cardinality(ids) > 60 then raise exception 'bad selection' using errcode = '22023'; end if;
  if amt is not null and amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct x), '{}') into uids from unnest(ids) x;
  foreach pid in array uids loop
    select * into f from match_fees where match_id = m and player_id = pid;
    if not found then raise exception 'player not in match fees' using errcode = 'P0002'; end if;
    a := coalesce(amt, f.amount - mp_paid(m, pid));
    if a > 0 then
      if f.paid and f.amount > 0 and not exists (select 1 from match_payments x where x.match_id = m and x.player_id = pid) then
        insert into match_payments (match_id, player_id, amount, paid_on, method, comment)
          values (m, pid, f.amount, current_date, 'import', 'Оплата из импорта');
      end if;
      insert into match_payments (match_id, player_id, amount, paid_on, method, comment)
        values (m, pid, a, coalesce(d, current_date), nullif(trim(mth), ''), nullif(trim(cmt), ''));
      perform match_fee_recalc(m, pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
