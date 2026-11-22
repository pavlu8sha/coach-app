-- Приведение написаний филиалов к названиям справочника (Red Garden, Isani, Ortachala), 21.11.2026. ВЫПОЛНЯЕТ ТОЛЬКО ПАВЕЛ после свежего preflight.
-- Нужна ли замена видно в шаге 1 (только чтение). Шаг 2 меняет только значения из перечня написаний (тот же перечень, что в web/src/lib/branches.ts);
-- разовые площадки (35-я школа, Surami Hotel и др.) и camps.location не меняются. Шаг 2 один оператор (одна транзакция): число строк
-- сверяется с числом из шага 1 (строка «ИТОГО к замене»), при несовпадении всё откатывается. Пустое число шаг не выполняет.
-- location_admins.location меняется вместе с остальными: по нему работают права администраторов локаций (cash_report сравнивает точным текстом).
-- Откат: вернуть прежние написания из результата шага 1 нельзя автоматически, поэтому перед шагом 2 сохраните результат шага 1.

-- ШАГ 0 (самопроверка, только чтение): должно вернуть true, true. Двойной пробел и табуляция внутри названия сводятся к одному пробелу, как в branches.ts.
select lower(regexp_replace(btrim(E'Red  Garden'), '[[:space:]]+', ' ', 'g')) = 'red garden' as двойной_пробел,
       lower(regexp_replace(btrim(E' Red\tGarden '), '[[:space:]]+', ' ', 'g')) = 'red garden' as табуляция;

-- ШАГ 1. Предпросмотр: где какие значения будут заменены, и сколько строк.
with alias(canon, a) as (values
  ('Red Garden', 'red garden'), ('Red Garden', 'redgarden'), ('Red Garden', 'ред гарден'), ('Red Garden', 'редгарден'), ('Red Garden', 'რედ გარდენ'),
  ('Isani', 'isani'), ('Isani', 'исани'), ('Isani', 'ისანი'),
  ('Ortachala', 'ortachala'), ('Ortachala', 'ортачала'), ('Ortachala', 'ორთაჭალა')),
v as (
  select 'groups.location' as src, location as val from groups
  union all select 'equipment_orders.location', location from equipment_orders
  union all select 'extra_sessions.place', place from extra_sessions
  union all select 'location_admins.location', location from location_admins
  union all select 'camps.location (не меняется)', location from camps)
select coalesce(src, 'ИТОГО к замене') as источник, val as сейчас, a.canon as станет, count(*) as строк
  from v join alias a on a.a = lower(regexp_replace(btrim(val), '[[:space:]]+', ' ', 'g')) and val <> a.canon and v.src not like 'camps%'
 group by rollup ((src, val, a.canon))
 order by 1, 2;
-- Значения, которые НЕ будут заменены (проверьте, что это не филиалы в необычном написании):
select src as источник, val as значение, count(*) as строк from (
  select 'groups.location' as src, location as val from groups
  union all select 'equipment_orders.location', location from equipment_orders
  union all select 'extra_sessions.place', place from extra_sessions
  union all select 'location_admins.location', location from location_admins) z
 where val is not null and btrim(val) <> '' and val not in ('Red Garden', 'Isani', 'Ortachala')
   and lower(regexp_replace(btrim(val), '[[:space:]]+', ' ', 'g')) not in ('red garden', 'redgarden', 'ред гарден', 'редгарден', 'რედ გარდენ', 'isani', 'исани', 'ისანი', 'ortachala', 'ортачала', 'ორთაჭალა')
 group by 1, 2 order by 1, 2;

-- ШАГ 2. Замена. Вставьте число из строки «ИТОГО к замене» шага 1 вместо null в exp (одной цифрой, без кавычек).
do $$ declare exp int := null; n int := 0; m int; begin if exp is null then raise exception 'вставьте число строк из шага 1 в exp'; end if; create temp table alias_t (canon text, a text) on commit drop; insert into alias_t values ('Red Garden', 'red garden'), ('Red Garden', 'redgarden'), ('Red Garden', 'ред гарден'), ('Red Garden', 'редгарден'), ('Red Garden', 'რედ გარდენ'), ('Isani', 'isani'), ('Isani', 'исани'), ('Isani', 'ისანი'), ('Ortachala', 'ortachala'), ('Ortachala', 'ортачала'), ('Ortachala', 'ორთაჭალა'); update groups g set location = t.canon from alias_t t where g.location <> t.canon and t.a = lower(regexp_replace(btrim(g.location), '[[:space:]]+', ' ', 'g')); get diagnostics m = row_count; n := n + m; update equipment_orders g set location = t.canon from alias_t t where g.location <> t.canon and t.a = lower(regexp_replace(btrim(g.location), '[[:space:]]+', ' ', 'g')); get diagnostics m = row_count; n := n + m; update extra_sessions g set place = t.canon from alias_t t where g.place <> t.canon and t.a = lower(regexp_replace(btrim(g.place), '[[:space:]]+', ' ', 'g')); get diagnostics m = row_count; n := n + m; update location_admins g set location = t.canon from alias_t t where g.location <> t.canon and t.a = lower(regexp_replace(btrim(g.location), '[[:space:]]+', ' ', 'g')); get diagnostics m = row_count; n := n + m; if n <> exp then raise exception 'заменено % строк, ожидалось %: откат', n, exp; end if; raise notice 'заменено строк: %', n; end $$;
