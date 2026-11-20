-- #652 этап 2c: read-only пробный прогон классификации 0207 (ничего не пишет, один SELECT).
-- Зачем: baseline readonly-eq-baseline-471.sql считает комплекты по упрощённому порядку (ordered_on, id), а 0207 решает по тому же
-- eq_bundle_calc (0205), что и расчёт скидки (порядок created_at, ordered_on, id, учёт количества). Для сверки перед запуском 0207 нужен
-- результат именно этого алгоритма: класс каждого заказа, участники комплекта, замыкающий, расчётная скидка и список заморозки.
-- Требует: применена 0205 (eq_bundle_calc, eq_bundle_setting, eq_order_lines_sum). 0207 для запуска не нужна.
-- Правила классов и заморозки повторяют eq_freeze_2c из 0207 (тест db/tests/rls_eq652_freeze_2c_test.sql сверяет этот запрос с результатом 0207 по каждому заказу).
-- Запускать в SQL Editor целиком (от имени владельца базы: у eq_bundle_calc права закрыты для ролей приложения).
-- Результат: раздел 1 (итоги), раздел 2 (заказы к заморозке: класс, delta, участник, замыкающий), раздел 3 (прочие заказы с ненулевой delta).
with pl as (
  select distinct o.player_id as pid, p.club_id as cid from equipment_orders o join players p on p.id = o.player_id
),
calc as materialized (
  select pl.pid, i.inp, eq_bundle_calc(i.inp) as res
    from pl
    cross join lateral (select jsonb_build_object(
      'settings', jsonb_build_object('pct', eq_bundle_setting(pl.cid, 'equip.discPct'), 'round', eq_bundle_setting(pl.cid, 'equip.discRound'),
        'need_own', eq_bundle_setting(pl.cid, 'equip.discNeedOwn'), 'need_all', eq_bundle_setting(pl.cid, 'equip.discNeedAll'), 'full', eq_bundle_setting(pl.cid, 'equip.fullPrice')),
      'orders', (select jsonb_agg(jsonb_build_object('id', e.id, 'status', e.status, 'created_at', e.created_at, 'ordered_on', e.ordered_on,
                  'forfeited', false, 'frozen', false) order by e.id) from equipment_orders e where e.player_id = pl.pid),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'order_id', l.order_id, 'kit', l.kit, 'quantity', l.quantity, 'unit_price', l.unit_price) order by l.id)
                  from equipment_order_lines l join equipment_orders e on e.id = l.order_id where e.player_id = pl.pid), '[]'::jsonb)) as inp) i
),
-- нулевой процент: eq_bundle_calc выходит рано без замыкающего заказа; состав и замыкающего берём пробным расчётом с процентом 1 (как в 0207)
probed as materialized (
  select c.pid, c.res,
         case when c.res->>'reason' = 'no_discount' and nullif(c.res->>'closing_order_id', '') is null
              then eq_bundle_calc(jsonb_set(c.inp, '{settings,pct}', '"1"'::jsonb)) end as probe
    from calc c
),
pp as (
  select p.pid,
         p.res->>'state' as st, p.res->>'reason' as rsn,
         coalesce((p.res->>'discount')::numeric, 0) as disc,
         case when p.probe is not null then nullif(p.probe->>'closing_order_id', '')::uuid else nullif(p.res->>'closing_order_id', '')::uuid end as closing,
         (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(coalesce(case when p.probe is not null then p.probe->'participants' else p.res->'participants' end, '[]'::jsonb)) x) as parts,
         case when p.probe is not null then nullif(p.probe->>'closing_order_id', '') is not null
              else (p.res->>'state' = 'active') or (p.res->>'reason' in ('need_all_failed', 'no_discount') and nullif(p.res->>'closing_order_id', '') is not null) end as full_set
    from probed p
),
ord as (
  select e.id, e.player_id, e.status, e.installment, e.total - eq_order_lines_sum(e.id) as delta,
         pp.st, pp.disc, pp.closing, pp.full_set, (pp.parts is not null and e.id = any (pp.parts)) as part
    from equipment_orders e left join pp on pp.pid = e.player_id
),
cls as (
  select o.*, case
    when o.player_id is null then case when o.delta = 0 then 'exact' when o.delta > 0 then 'manual_up' else 'manual_down' end
    when o.delta = 0 then 'exact'
    when o.delta > 0 then 'manual_up'
    when o.status = 'cancelled' then 'manual_down'
    when o.st = 'unchecked' then 'legacy_review'
    when not o.full_set then 'manual_down'
    when o.id = o.closing and not o.installment and o.st = 'active' and abs(o.delta + o.disc) <= 0.01 then 'legacy_confirmed'
    else 'legacy_review' end as cls
    from ord o
),
pf as (
  select c.player_id, bool_or(c.cls = 'legacy_confirmed') as conf, bool_or(c.cls = 'legacy_review') as rev
    from cls c where c.player_id is not null group by c.player_id
),
fin as (
  select c.*, (c.status <> 'cancelled' and c.player_id is not null and (
            (pf.conf and (c.part or c.cls = 'legacy_confirmed'))
         or (pf.rev and (c.cls = 'legacy_review' or (not pf.conf and c.part))))) as will_freeze
    from cls c left join pf on pf.player_id = c.player_id
),
rws as (
  select 1 as s, 'заказов' as k, count(*)::text as v from fin
  union all select 1, 'итог', coalesce(sum(e.total), 0)::text from equipment_orders e
  union all select 1, 'оплачено', coalesce(sum(e.paid), 0)::text from equipment_orders e
  union all select 1, 'класс ' || f.cls, count(*)::text from fin f group by f.cls
  union all select 1, 'заказов к заморозке', count(*)::text from fin where will_freeze
  union all select 1, 'детей с legacy_confirmed', count(distinct player_id)::text from fin where cls = 'legacy_confirmed'
  union all select 1, 'сумма delta у legacy_confirmed', coalesce(sum(delta), 0)::text from fin where cls = 'legacy_confirmed'
  union all select 1, 'в рассрочку без отказа (включая отменённые)', count(*)::text from equipment_orders where installment and not discount_forfeited
  union all select 1, 'md5 списка заказ|класс|заморозка', md5(coalesce(string_agg(concat_ws('|', id, cls, will_freeze), ',' order by id), '')) from fin
  union all select 2, f.id::text, concat_ws(' | ', f.cls, 'delta ' || f.delta, case when f.part then 'участник комплекта' end,
                                           case when f.id = f.closing then 'замыкающий' end, 'скидка ' || f.disc, case when f.installment then 'рассрочка' end,
                                           'ребёнок ' || f.player_id)
    from fin f where f.will_freeze
  union all select 3, f.id::text, concat_ws(' | ', f.cls, 'delta ' || f.delta, f.status, 'ребёнок ' || coalesce(f.player_id::text, '-'))
    from fin f where f.delta <> 0 and not f.will_freeze
)
select s as "раздел", k as "ключ", v as "значение" from rws order by s, k;
