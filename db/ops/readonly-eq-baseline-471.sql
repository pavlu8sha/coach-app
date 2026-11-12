-- #471 PR-0: контрольные значения экипировки до миграций (и после каждой из них). ТОЛЬКО ЧТЕНИЕ.
-- Условия: docs/acceptance/eq-471-pr0-baseline-2026-11-12.md. План: /mnt/project-files/equipment-471/tech-plan-471-v5-final-2026-11-11.md, раздел 8.
-- Запуск: SQL Editor, весь файл целиком. Файл содержит ОДИН запрос select (SQL Editor показывает результат последнего запроса),
-- без вызова функций приложения и без операций записи; это проверяет tests/eq471-pr0.test.mjs.
-- Результат (раздел, показатель, значение) сохранить целиком (Export -> CSV) до первой миграции #471 и после каждой.
-- Сравнивать по колонкам «раздел» и «показатель»; ожидаемые изменения перечислены в условиях приёмки, остальное должно совпасть.
-- Порядок заказов для расчёта комплекта: дата заказа (пустая раньше всех), затем id заказа и id строки
-- (колонки created_at у заказов до миграций нет; PR-1 заполнит её тем же порядком).
with
cfg as (
  select
    coalesce(nullif(trim((select value from club_settings where key = 'equip.discNeedOwn' and scope = '' limit 1)), ''),
             'Игровая форма или Вратарская форма, Тренировочная форма, Спортивный костюм, Дождевик') as need_own,
    coalesce(nullif(trim((select value from club_settings where key = 'equip.discNeedAll' and scope = '' limit 1)), ''),
             'Игровая форма или Вратарская форма или Тренировочная форма или Спортивный костюм или Дождевик') as need_all,
    coalesce((select value from club_settings where key = 'equip.fullPrice' and scope = '' limit 1), 'Носки, Гетры') as full_price,
    coalesce(nullif(trim((select value from club_settings where key = 'equip.discPct' and scope = '' limit 1)), ''), '15') as pct_raw,
    coalesce(nullif(trim((select value from club_settings where key = 'equip.discRound' and scope = '' limit 1)), ''), '5') as round_raw
),
num as (
  select c.*,
    case when pct_raw ~ '^\d+(\.\d+)?$' and pct_raw::numeric > 0 and pct_raw::numeric <= 90 then pct_raw::numeric end as pct,
    case when round_raw ~ '^\d+$' and round_raw::int between 1 and 100 then round_raw::int end as rnd
  from cfg c
),
-- правило «A или B, C»: группа = часть через запятую, внутри группы варианты через «или»
own_groups as (
  select g.ord as grp, lower(trim(v.kit)) as kit
  from num, regexp_split_to_table(num.need_own, ',') with ordinality as g(txt, ord),
       regexp_split_to_table(g.txt, '\s+или\s+', 'i') as v(kit)
  where trim(v.kit) <> ''
),
all_groups as (
  select g.ord as grp, lower(trim(v.kit)) as kit
  from num, regexp_split_to_table(num.need_all, ',') with ordinality as g(txt, ord),
       regexp_split_to_table(g.txt, '\s+или\s+', 'i') as v(kit)
  where trim(v.kit) <> ''
),
full_kits as (
  select lower(trim(k)) as kit from num, regexp_split_to_table(num.full_price, ',') as k where trim(k) <> ''
),
o as (
  select eo.*, coalesce((select sum(l.unit_price * l.quantity) from equipment_order_lines l where l.order_id = eo.id), 0) as lines_sum,
         (select count(*) from equipment_order_lines l where l.order_id = eo.id) as line_cnt
  from equipment_orders eo
),
-- кандидаты в члены комплекта: строка подходит группе, позиция не «по полной цене»
cand as (
  select o.player_id, og.grp, l.id as line_id, l.order_id, l.unit_price,
         row_number() over (partition by o.player_id, og.grp order by o.ordered_on nulls first, o.id, l.id) as rn
  from o join equipment_order_lines l on l.order_id = o.id
  join own_groups og on og.kit = lower(trim(l.kit))
  where o.player_id is not null and lower(trim(l.kit)) not in (select kit from full_kits)
),
members as (select * from cand where rn = 1),
kid_set as (
  select m.player_id, sum(m.unit_price) as base, count(distinct m.grp) as grp_have,
         (select count(distinct grp) from own_groups) as grp_need
  from members m group by m.player_id
),
closing as (
  select distinct on (m.player_id) m.player_id, m.order_id
  from members m join o on o.id = m.order_id
  order by m.player_id, o.ordered_on desc nulls last, o.id desc
),
kid as (
  select s.player_id, s.base, (s.grp_have = s.grp_need and s.grp_need > 0) as full_set, c.order_id as closing_order,
         case when n.pct is null or n.rnd is null then null
              else s.base - greatest(floor(s.base * (1 - n.pct / 100) / n.rnd + 0.5) * n.rnd, 0) end as disc,
         -- discNeedAll: каждая группа правила выполнена строками замыкающего заказа
         not exists (
           select 1 from (select distinct grp from all_groups) ag
           where not exists (select 1 from all_groups a2 join equipment_order_lines l on lower(trim(l.kit)) = a2.kit
                             where a2.grp = ag.grp and l.order_id = c.order_id)
         ) and exists (select 1 from all_groups) as need_all_ok
  from kid_set s join closing c on c.player_id = s.player_id cross join num n
),
cls as (
  select o.id, o.player_id, o.total, o.lines_sum, o.total - o.lines_sum as delta, o.installment, k.full_set, k.disc, k.need_all_ok,
         (k.closing_order = o.id) as is_closing,
         case
           when o.total - o.lines_sum = 0 then 'exact'
           when o.total - o.lines_sum > 0 then 'manual_up'
           when coalesce(k.full_set, false) is false then 'manual_down'
           when k.closing_order = o.id and not o.installment and k.need_all_ok and k.disc is not null
                and abs((o.total - o.lines_sum) + k.disc) <= 0.01 then 'legacy_confirmed'
           else 'legacy_review'
         end as cls
  from o left join kid k on k.player_id = o.player_id
),
jr as (
  select o.id, o.paid, coalesce((select sum(sp.amount) from service_payments sp where sp.kind = 'equipment' and sp.ref_id = o.id), 0) as jsum
  from o
),
rows as (
  -- 1. заказы
  select 10 as s, '1 заказы' as section, 'всего заказов' as metric, count(*)::text as value from o
  union all select 11, '1 заказы', 'сумма total', coalesce(sum(total), 0)::text from o
  union all select 12, '1 заказы', 'сумма paid', coalesce(sum(paid), 0)::text from o
  union all select 13, '1 заказы', 'сумма строк (unit_price × quantity)', coalesce(sum(lines_sum), 0)::text from o
  union all select 14, '1 заказы', 'без игрока', count(*)::text from o where player_id is null
  union all select 15, '1 заказы', 'без строк', count(*)::text from o where line_cnt = 0
  union all select 16, '1 заказы', 'без даты заказа', count(*)::text from o where ordered_on is null
  union all select 17, '1 заказы', 'в рассрочку', count(*)::text from o where installment
  union all select 18, '1 заказы', 'paid > total', count(*)::text from o where paid > total
  union all select 19, '1 заказы', 'статус ' || status, count(*)::text from o group by status
  union all select 20, '1 заказы', 'локация ' || coalesce(nullif(location, ''), '(пусто)'), count(*)::text || ' / total ' || sum(total)::text || ' / paid ' || sum(paid)::text from o group by coalesce(nullif(location, ''), '(пусто)')
  union all select 21, '1 заказы', 'строк заказов', (select count(*)::text from equipment_order_lines)
  union all select 22, '1 заказы', 'отпечаток заказов md5(id,total,paid,status,installment,location,ordered_on)',
    (select md5(coalesce(string_agg(concat_ws('|', id, total, paid, status, installment, location, ordered_on), ',' order by id), '')) from o)
  union all select 23, '1 заказы', 'отпечаток строк md5(id,order_id,kit,size,quantity,unit_price)',
    (select md5(coalesce(string_agg(concat_ws('|', id, order_id, kit, size, quantity, unit_price), ',' order by id), '')) from equipment_order_lines)
  -- 2. журнал оплат
  union all select 30, '2 журнал', 'строк ' || kind, count(*)::text || ' / сумма ' || sum(amount)::text from service_payments group by kind
  union all select 31, '2 журнал', 'экипировка по месяцам ' || to_char(paid_on, 'YYYY-MM'), count(*)::text || ' / сумма ' || sum(amount)::text
    from service_payments where kind = 'equipment' group by to_char(paid_on, 'YYYY-MM')
  union all select 32, '2 журнал', 'экипировка: строк с минусом', count(*)::text || ' / сумма ' || coalesce(sum(amount), 0)::text from service_payments where kind = 'equipment' and amount < 0
  union all select 33, '2 журнал', 'отпечаток журнала экипировки md5(id,ref_id,amount,paid_on,method,cancels)',
    (select md5(coalesce(string_agg(concat_ws('|', id, ref_id, amount, paid_on, method, cancels), ',' order by id), '')) from service_payments where kind = 'equipment')
  union all select 34, '2 журнал', 'заказов: paid = сумме журнала', count(*)::text from jr where paid = jsum
  union all select 35, '2 журнал', 'заказов: paid > суммы журнала (нужен opening_balance)', count(*)::text || ' / разница ' || coalesce(sum(paid - jsum), 0)::text from jr where paid > jsum
  union all select 36, '2 журнал', 'заказов: paid < суммы журнала (АНОМАЛИЯ, разбирает владелец)', count(*)::text from jr where paid < jsum
  union all select 37, '2 журнал', 'аномалия: заказ ' || jr.id::text, 'paid ' || jr.paid::text || ' / журнал ' || jr.jsum::text from jr where jr.paid < jr.jsum
  -- 3. итог против суммы строк, классы по плану (2.10)
  union all select 40, '3 классы', 'настройки скидки', 'pct ' || coalesce(pct::text, 'ОШИБКА: ' || pct_raw) || ' / округление ' || coalesce(rnd::text, 'ОШИБКА: ' || round_raw) from num
  union all select 41, '3 классы', 'класс ' || cls, count(*)::text || ' / сумма delta ' || sum(delta)::text from cls group by cls
  union all select 42, '3 классы', 'заказ ' || c.id::text || ' (' || coalesce(p.full_name, 'без игрока') || ')',
    c.cls || ': total ' || c.total::text || ', строки ' || c.lines_sum::text || ', delta ' || c.delta::text
    || ', комплект ' || case when c.full_set then 'полный' else 'нет' end
    || coalesce(', расчётная скидка ' || c.disc::text, '') || case when c.is_closing then ', замыкающий' else '' end
    || case when c.installment then ', рассрочка' else '' end || case when c.need_all_ok is false then ', discNeedAll не выполнено' else '' end
    from cls c left join players p on p.id = c.player_id where c.cls <> 'exact'
  -- 4. выдача
  union all select 50, '4 выдача', 'строк выдачи', (select count(*)::text from equipment_issues)
  union all select 51, '4 выдача', 'строки заказа с количеством > 1 и отметкой выдачи',
    (select count(*)::text from equipment_order_lines l where l.quantity > 1 and exists (select 1 from equipment_issues i where i.order_id = l.order_id and i.kit = l.kit))
  union all select 52, '4 выдача', 'количество > 1 с выдачей: строка ' || l.id::text, 'заказ ' || l.order_id::text || ', ' || l.kit || ' × ' || l.quantity::text
    from equipment_order_lines l where l.quantity > 1 and exists (select 1 from equipment_issues i where i.order_id = l.order_id and i.kit = l.kit)
  union all select 53, '4 выдача', 'статус «Выдан», но выдано не всё', count(*)::text from o
    where status = 'issued' and exists (select 1 from equipment_order_lines l where l.order_id = o.id and not exists (select 1 from equipment_issues i where i.order_id = o.id and i.kit = l.kit))
  union all select 54, '4 выдача', 'выдано всё, но статус не «Выдан»', count(*)::text from o
    where status <> 'issued' and line_cnt > 0 and not exists (select 1 from equipment_order_lines l where l.order_id = o.id and not exists (select 1 from equipment_issues i where i.order_id = o.id and i.kit = l.kit))
  union all select 55, '4 выдача', 'записей истории статусов', (select count(*)::text from equipment_order_status_history)
  -- 5. отчёты (функции отчётов требуют входа администратора, поэтому их суммы повторены прямым запросом к журналу)
  union all select 60, '5 касса', 'экипировка ' || to_char(sp.paid_on, 'YYYY-MM') || ' / ' || coalesce(sp.method, '(без способа)') || ' / ' || coalesce(nullif(eo.location, ''), '(пусто)'),
    count(*)::text || ' / сумма ' || sum(sp.amount)::text
    from service_payments sp left join equipment_orders eo on eo.id = sp.ref_id
    where sp.kind = 'equipment' and sp.paid_on >= date '2026-10-01'
    group by to_char(sp.paid_on, 'YYYY-MM'), coalesce(sp.method, '(без способа)'), coalesce(nullif(eo.location, ''), '(пусто)')
  union all select 61, '5 долги', 'экипировка: к оплате по всем заказам (total − paid > 0)', count(*)::text || ' заказов / ' || coalesce(sum(total - paid), 0)::text from o where total > paid
  -- 6. права и защита
  union all select 70, '6 права', 'grant ' || table_name || ' → ' || grantee, string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('equipment_orders', 'equipment_order_lines', 'equipment_issues', 'equipment_catalog', 'equipment_order_status_history', 'service_payments')
      and grantee in ('anon', 'authenticated', 'service_role')
    group by table_name, grantee
  union all select 71, '6 права', 'policy ' || tablename || '.' || policyname, cmd from pg_policies
    where schemaname = 'public' and tablename in ('equipment_orders', 'equipment_order_lines', 'equipment_issues', 'equipment_catalog', 'equipment_order_status_history', 'service_payments')
  union all select 72, '6 права', 'trigger ' || c.relname || '.' || t.tgname, t.tgenabled::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.relname in ('equipment_orders', 'equipment_order_lines', 'equipment_issues', 'equipment_order_status_history', 'service_payments')
  union all select 73, '6 права', 'локальные админы: локация ' || location, count(*)::text from location_admins group by location
  union all select 74, '6 права', 'FK on delete ' || conrelid::regclass::text || ' → ' || confrelid::regclass::text,
    case confdeltype when 'c' then 'cascade' when 'r' then 'restrict' when 'a' then 'no action' when 'n' then 'set null' else confdeltype::text end
    from pg_constraint where contype = 'f' and conrelid::regclass::text in ('equipment_orders', 'equipment_order_lines', 'equipment_issues', 'equipment_order_status_history', 'service_payments')
  -- 7. очередь уведомлений (после миграций #471 не должна вырасти от самих миграций)
  union all select 80, '7 уведомления', 'notifications ' || kind || ' / ' || state, count(*)::text from notifications group by kind, state
)
select section as "раздел", metric as "показатель", value as "значение" from rows order by s, section, metric;
