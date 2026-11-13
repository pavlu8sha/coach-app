-- 0182: смена цены тарифа сбора пересчитывает записанных (условия: docs/CAMP_TARIFF_REPRICE_ACCEPTANCE.md, 1-14).
-- Причина: camp_participants.amount — снимок цены на момент записи; camp_tariff_save раньше его не менял (урок 2026-11-12).
--  * camp_tariff_save теперь возвращает jsonb {old_price, new_price, updated, overpaid, manual}. Суммы записей registered этого тарифа,
--    равные старой цене, становятся новой ценой, если внесено не больше новой цены. Переплаченные и ручные суммы не меняются,
--    платежи не трогаются, журнал записи пишет триггер camp_participants_log (0166);
--  * camp_tariff_reprice_preview: те же счётчики без изменений (для подтверждения в карточке сбора);
--  * camp_tariff_reprice_counts: внутренняя общая часть, вызывающим не выдана.
-- Тип результата camp_tariff_save меняется (void → jsonb), поэтому функция пересоздаётся; права выдаются заново.

create or replace function camp_tariff_reprice_counts(tid uuid, old_price numeric, new_price numeric) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'old_price', old_price, 'new_price', new_price,
    'updated',  count(*) filter (where p.amount = old_price and q.paid <= new_price and old_price <> new_price),
    'overpaid', count(*) filter (where p.amount = old_price and q.paid > new_price and old_price <> new_price),
    'manual',   count(*) filter (where p.amount <> old_price and old_price <> new_price))
  from camp_participants p
  cross join lateral (select coalesce(sum(x.amount), 0) as paid from camp_payments x where x.participant_id = p.id) q
  where p.tariff_id = tid and p.status = 'registered'
$$;
revoke execute on function camp_tariff_reprice_counts(uuid, numeric, numeric) from public, anon, authenticated;

create or replace function camp_tariff_reprice_preview(cid uuid, nm text, pr numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid; old numeric;
begin
  perform camp_assert_admin();
  select id, price into tid, old from camp_tariffs where camp_id = cid and name = trim(nm);
  if tid is null then return jsonb_build_object('old_price', pr, 'new_price', pr, 'updated', 0, 'overpaid', 0, 'manual', 0); end if;
  return camp_tariff_reprice_counts(tid, old, pr);
end $$;

drop function if exists camp_tariff_save(uuid, text, numeric, boolean);
create function camp_tariff_save(cid uuid, nm text, pr numeric, act boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid; old numeric; res jsonb;
begin
  perform camp_assert_admin();
  if nullif(trim(nm), '') is null or pr is null or pr < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if not exists (select 1 from camps where id = cid) then raise exception 'camp not found' using errcode = 'P0002'; end if;
  select id, price into tid, old from camp_tariffs where camp_id = cid and name = trim(nm) for update;
  if tid is null then
    insert into camp_tariffs (camp_id, name, price, active) values (cid, trim(nm), pr, coalesce(act, true))
    on conflict (camp_id, name) do update set price = excluded.price, active = excluded.active
    returning id into tid;
    return jsonb_build_object('old_price', pr, 'new_price', pr, 'updated', 0, 'overpaid', 0, 'manual', 0);
  end if;
  -- записи блокируются, чтобы параллельная оплата не успела сделать сумму ниже внесённого
  perform 1 from camp_participants where tariff_id = tid and status = 'registered' for update;
  res := camp_tariff_reprice_counts(tid, old, pr);
  update camp_tariffs set price = pr, active = coalesce(act, true) where id = tid;
  if old <> pr then
    update camp_participants p set amount = pr
     where p.tariff_id = tid and p.status = 'registered' and p.amount = old
       and pr >= coalesce((select sum(x.amount) from camp_payments x where x.participant_id = p.id), 0);
  end if;
  return res;
end $$;

revoke execute on function camp_tariff_save(uuid, text, numeric, boolean), camp_tariff_reprice_preview(uuid, text, numeric) from public, anon;
grant execute on function camp_tariff_save(uuid, text, numeric, boolean), camp_tariff_reprice_preview(uuid, text, numeric) to authenticated;
