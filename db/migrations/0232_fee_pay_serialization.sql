-- 0232: сериализация оплат взносов матчей и событий (Issue #722). Условия приёмки: docs/FEE_PAY_SERIALIZATION_ACCEPTANCE.md.
-- event_pay и match_pay считали доплату по остатку без блокировки: два параллельных вызова с amt = NULL оба видели остаток и оба платили его.
-- Теперь строка взноса игрока (tournament_fees / match_fees) блокируется for update до чтения остатка (tp_paid / mp_paid), материализации импортированной оплаты и вставки платежа;
-- игроки блокируются в порядке player_id (array_agg(distinct x order by x)), чтобы пакеты с пересекающимися наборами не давали deadlock.
-- Тела взяты из 0072 (последние определения: grep -lEi "function +(public\.)?(event_pay|match_pay) *\(" db/migrations/*.sql даёт 0053, 0054, 0061, 0071, 0072), логика и проверки доступа не менялись.
-- search_path у обеих функций: public, pg_temp. Объекты схемы квалифицированы public. Привилегии (authenticated да, anon/public нет) сохраняются create or replace. Откат: db/ops/rollback-0232-fee-pay-serialization.sql.
create or replace function public.event_pay(t uuid, ids uuid[], amt numeric, d date, mth text, cmt text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare uids uuid[]; pid uuid; f public.tournament_fees; a numeric; n int := 0;
begin
  perform public.event_assert_admin();
  if ids is null or cardinality(ids) = 0 or cardinality(ids) > 60 then raise exception 'bad selection' using errcode = '22023'; end if;
  if amt is not null and amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into uids from unnest(ids) x;
  foreach pid in array uids loop
    select * into f from public.tournament_fees where tournament_id = t and player_id = pid for update;
    if not found then raise exception 'player not in event' using errcode = 'P0002'; end if;
    a := coalesce(amt, f.amount - public.tp_paid(t, pid));
    if a > 0 then
      if f.paid and f.amount > 0 and not exists (select 1 from public.tournament_payments x where x.tournament_id = t and x.player_id = pid) then
        insert into public.tournament_payments (tournament_id, player_id, amount, paid_on, method, comment)
          values (t, pid, f.amount, current_date, 'import', 'Оплата из импорта');
      end if;
      insert into public.tournament_payments (tournament_id, player_id, amount, paid_on, method, comment)
        values (t, pid, a, coalesce(d, current_date), nullif(trim(mth), ''), nullif(trim(cmt), ''));
      perform public.event_fee_recalc(t, pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.match_pay(m uuid, ids uuid[], amt numeric, d date, mth text, cmt text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare uids uuid[]; pid uuid; f public.match_fees; a numeric; n int := 0;
begin
  perform public.match_assert_fees(m);
  if ids is null or cardinality(ids) = 0 or cardinality(ids) > 60 then raise exception 'bad selection' using errcode = '22023'; end if;
  if amt is not null and amt <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into uids from unnest(ids) x;
  foreach pid in array uids loop
    select * into f from public.match_fees where match_id = m and player_id = pid for update;
    if not found then raise exception 'player not in match fees' using errcode = 'P0002'; end if;
    a := coalesce(amt, f.amount - public.mp_paid(m, pid));
    if a > 0 then
      if f.paid and f.amount > 0 and not exists (select 1 from public.match_payments x where x.match_id = m and x.player_id = pid) then
        insert into public.match_payments (match_id, player_id, amount, paid_on, method, comment)
          values (m, pid, f.amount, current_date, 'import', 'Оплата из импорта');
      end if;
      insert into public.match_payments (match_id, player_id, amount, paid_on, method, comment)
        values (m, pid, a, coalesce(d, current_date), nullif(trim(mth), ''), nullif(trim(cmt), ''));
      perform public.match_fee_recalc(m, pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
