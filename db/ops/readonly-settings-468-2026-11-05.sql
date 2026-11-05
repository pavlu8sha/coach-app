-- Read-only инвентаризация настроек #468 (A2). Только select: ничего не меняет.
-- Запускать в Supabase SQL Editor. Не применять как миграцию.
-- Проверяет старые и новые ключи A2 по всем клубам. История изменений не проверяется.

-- =====================================================================
-- 1. Старые и новые ключи: все найденные строки
-- =====================================================================
with keys(new_key, old_key) as (values
  ('equip.fullPrice', 'equip.discExclude'),
  ('groups.order', 'att.groupOrder'),
  ('payments.nextMonthDay', 'subs.nextMonthDay')
)
select
  c.id as club_id,
  c.name as club_name,
  k.new_key,
  k.old_key,
  s.key,
  case when s.key = k.old_key then 'old' else 'new' end as kind,
  s.scope,
  s.value,
  s.updated_at
from clubs c
cross join keys k
join club_settings s on s.club_id = c.id and s.key in (k.new_key, k.old_key)
order by c.id, k.new_key, kind, s.scope;

-- =====================================================================
-- 2. Сводка по клубам: есть ли строки и значения
-- =====================================================================
with keys(new_key, old_key) as (values
  ('equip.fullPrice', 'equip.discExclude'),
  ('groups.order', 'att.groupOrder'),
  ('payments.nextMonthDay', 'subs.nextMonthDay')
)
select
  k.new_key,
  k.old_key,
  count(distinct c.id) as clubs_total,
  count(distinct s.club_id) filter (where s.key = k.old_key) as clubs_with_old,
  count(distinct s.club_id) filter (where s.key = k.new_key) as clubs_with_new,
  count(s.value) filter (where s.key = k.old_key) as old_values,
  count(s.value) filter (where s.key = k.new_key) as new_values
from clubs c
cross join keys k
left join club_settings s on s.club_id = c.id and s.key in (k.new_key, k.old_key)
group by k.new_key, k.old_key
order by k.new_key;

-- =====================================================================
-- 3. Конфликты: есть и старый, и новый ключ с разными значениями
-- =====================================================================
with keys(new_key, old_key) as (values
  ('equip.fullPrice', 'equip.discExclude'),
  ('groups.order', 'att.groupOrder'),
  ('payments.nextMonthDay', 'subs.nextMonthDay')
),
vals as (
  select c.id as club_id, c.name as club_name, k.new_key, k.old_key, s.key, s.scope, s.value
  from clubs c
  cross join keys k
  join club_settings s on s.club_id = c.id and s.key in (k.new_key, k.old_key)
)
select
  o.club_id,
  o.club_name,
  o.new_key,
  o.old_key,
  o.scope,
  o.value as old_value,
  n.value as new_value
from vals o
join vals n on n.club_id = o.club_id and n.new_key = o.new_key and n.scope = o.scope and n.key = o.new_key
where o.key = o.old_key
  and o.value is distinct from n.value
order by o.club_id, o.new_key, o.scope;
