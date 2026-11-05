-- 0117: версионируемые правила системы баллов (#18, этап 2).
-- Только справочник правил и управление им. Начисления не подключены: старые point_events, apply_match_points,
-- award_bonus, revoke_bonus, recalc_match_points и points_start не затрагиваются.
-- Правило версии — снимок всех параметров целиком. Версия неизменна; изменение = новая версия с датой вступления в силу.
-- Расчёт события берёт версию, действовавшую на дату события (points_rules_for).
-- Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

create table points_rule_versions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  effective_from date not null,
  params jsonb not null,
  comment text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (club_id, effective_from)
);

alter table points_rule_versions enable row level security;
create policy points_rule_versions_read on points_rule_versions for select using (current_user_id() is not null);
grant select on points_rule_versions to authenticated;
grant select, insert, update, delete on points_rule_versions to service_role;
revoke insert, update, delete on points_rule_versions from authenticated;

-- версия неизменна: ни правка, ни удаление (в том числе для владельца роли через обычные запросы)
create or replace function points_rule_versions_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'points rule version is immutable' using errcode = '42501';
end $$;
create trigger points_rule_versions_no_change before update or delete on points_rule_versions
  for each row execute function points_rule_versions_immutable();

-- Проверка параметров. Ошибка = исключение с понятным кодом. Структура:
-- training: {group, individual, goalkeeper, extra, moved_group}: целые 0..20
-- match: {played, draw, win, goal, best, cap, technical}: целые 0..20, cap 1..50
-- manual: {values: [целые 1..5], limits: {"1": n, ...}, month_cap}
-- series: {thresholds: [{count, bonus}, ...]}: count возрастает, 1..1000, bonus 0..100
-- group_benchmark: {min_size 2..50}
-- enabled: {training, match, series, manual, benchmark}: boolean
create or replace function points_rules_validate(p jsonb) returns void
language plpgsql immutable set search_path = public as $$
declare k text; v jsonb; prev int := 0; t jsonb; c int; b int; vals int[]; lim jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'params must be an object' using errcode = '22023'; end if;
  foreach k in array array['training', 'match', 'manual', 'series', 'group_benchmark', 'enabled'] loop
    if jsonb_typeof(p -> k) is distinct from 'object' then raise exception 'missing section %', k using errcode = '22023'; end if;
  end loop;

  foreach k in array array['group', 'individual', 'goalkeeper', 'extra', 'moved_group'] loop
    v := p -> 'training' -> k;
    if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}') !~ '^\d+$' or (v #>> '{}')::int > 20 then
      raise exception 'training.% must be integer 0..20', k using errcode = '22023';
    end if;
  end loop;

  foreach k in array array['played', 'draw', 'win', 'goal', 'best', 'technical'] loop
    v := p -> 'match' -> k;
    if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}') !~ '^\d+$' or (v #>> '{}')::int > 20 then
      raise exception 'match.% must be integer 0..20', k using errcode = '22023';
    end if;
  end loop;
  v := p -> 'match' -> 'cap';
  if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}') !~ '^\d+$' or (v #>> '{}')::int not between 1 and 50 then
    raise exception 'match.cap must be integer 1..50' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'manual' -> 'values') is distinct from 'array' or jsonb_array_length(p -> 'manual' -> 'values') = 0 then
    raise exception 'manual.values must be a non-empty array' using errcode = '22023';
  end if;
  select array_agg(x) into vals from (
    select case when jsonb_typeof(e) = 'number' and (e #>> '{}') ~ '^\d+$' then (e #>> '{}')::int end as x
    from jsonb_array_elements(p -> 'manual' -> 'values') e) s;
  if exists (select 1 from unnest(vals) u where u is null or u not between 1 and 5) then
    raise exception 'manual.values must be integers 1..5' using errcode = '22023';
  end if;
  lim := p -> 'manual' -> 'limits';
  if jsonb_typeof(lim) is distinct from 'object' then raise exception 'manual.limits must be an object' using errcode = '22023'; end if;
  for k, v in select * from jsonb_each(lim) loop
    if not (k ~ '^\d+$' and k::int = any (vals)) then raise exception 'manual.limits key % is not in values', k using errcode = '22023'; end if;
    if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}') !~ '^\d+$' or (v #>> '{}')::int > 31 then
      raise exception 'manual.limits.% must be integer 0..31', k using errcode = '22023';
    end if;
  end loop;
  v := p -> 'manual' -> 'month_cap';
  if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}') !~ '^\d+$' or (v #>> '{}')::int > 1000 then
    raise exception 'manual.month_cap must be integer 0..1000' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'series' -> 'thresholds') is distinct from 'array' then
    raise exception 'series.thresholds must be an array' using errcode = '22023';
  end if;
  for t in select * from jsonb_array_elements(p -> 'series' -> 'thresholds') loop
    if jsonb_typeof(t -> 'count') is distinct from 'number' or (t ->> 'count') !~ '^\d+$'
       or jsonb_typeof(t -> 'bonus') is distinct from 'number' or (t ->> 'bonus') !~ '^\d+$' then
      raise exception 'series.thresholds items need integer count and bonus' using errcode = '22023';
    end if;
    c := (t ->> 'count')::int; b := (t ->> 'bonus')::int;
    if c < 1 or c > 1000 or b > 100 then raise exception 'series threshold out of range' using errcode = '22023'; end if;
    if c <= prev then raise exception 'series.thresholds counts must increase' using errcode = '22023'; end if;
    prev := c;
  end loop;

  v := p -> 'group_benchmark' -> 'min_size';
  if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}') !~ '^\d+$' or (v #>> '{}')::int not between 2 and 50 then
    raise exception 'group_benchmark.min_size must be integer 2..50' using errcode = '22023';
  end if;

  foreach k in array array['training', 'match', 'series', 'manual', 'benchmark'] loop
    if jsonb_typeof(p -> 'enabled' -> k) is distinct from 'boolean' then
      raise exception 'enabled.% must be boolean', k using errcode = '22023';
    end if;
  end loop;
end $$;

-- Версия правил на дату события (самая поздняя из вступивших в силу); пусто, если версий ещё нет
create or replace function points_rules_for(c uuid, d date) returns points_rule_versions
language sql stable security definer set search_path = public as $$
  select * from points_rule_versions where club_id = c and effective_from <= d order by effective_from desc limit 1
$$;

-- Текущие правила для интерфейса администратора: все версии клуба, новые сверху
create or replace function points_rules_list() returns setof points_rule_versions
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select v.* from points_rule_versions v order by v.effective_from desc;
end $$;

-- Новая версия правил. Только администратор. Вступает в силу не раньше сегодняшнего дня (по времени клуба).
-- На одну дату вступления версия одна; повтор с теми же параметрами на ту же дату ничего не создаёт (идемпотентно).
create or replace function points_rules_save(eff date, p jsonb, note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; ex points_rule_versions; vid uuid; prev points_rule_versions;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if eff is null then raise exception 'effective date required' using errcode = '22023'; end if;
  if eff < tbilisi_day(now()) then raise exception 'effective date in the past' using errcode = '22023'; end if;
  perform points_rules_validate(p);
  select id into c from clubs order by id limit 1;
  perform pg_advisory_xact_lock(hashtext('points_rules:' || c::text));
  select * into ex from points_rule_versions where club_id = c and effective_from = eff;
  if ex.id is not null then
    if ex.params = p then return ex.id; end if;
    raise exception 'version for this date already exists' using errcode = '23505';
  end if;
  select * into prev from points_rules_for(c, eff);
  insert into points_rule_versions (club_id, effective_from, params, comment, created_by)
    values (c, eff, p, nullif(trim(note), ''), current_user_id()) returning id into vid;
  insert into audit_log (actor_id, action, entity, entity_id, before, after)
    values (current_user_id(), 'points_rules_save', 'points_rule_versions', vid,
            case when prev.id is null then null else jsonb_build_object('effective_from', prev.effective_from, 'params', prev.params) end,
            jsonb_build_object('effective_from', eff, 'params', p, 'comment', nullif(trim(note), '')));
  return vid;
end $$;

revoke execute on function points_rules_validate(jsonb), points_rules_for(uuid, date), points_rules_list(), points_rules_save(date, jsonb, text) from public, anon;
grant execute on function points_rules_list(), points_rules_save(date, jsonb, text) to authenticated;
grant execute on function points_rules_validate(jsonb) to authenticated;

-- Стартовая версия: правила, согласованные владельцем 2026-11-04; действует с даты запуска 2026-12-01.
insert into points_rule_versions (club_id, effective_from, params, comment)
select c.id, date '2026-12-01', jsonb_build_object(
  'training', jsonb_build_object('group', 1, 'individual', 2, 'goalkeeper', 2, 'extra', 2, 'moved_group', 1),
  'match', jsonb_build_object('played', 1, 'draw', 1, 'win', 2, 'goal', 1, 'best', 2, 'cap', 5, 'technical', 0),
  'manual', jsonb_build_object('values', jsonb_build_array(1, 2, 3), 'limits', jsonb_build_object('1', 3, '2', 2, '3', 1), 'month_cap', 10),
  'series', jsonb_build_object('thresholds', jsonb_build_array(
    jsonb_build_object('count', 6, 'bonus', 1), jsonb_build_object('count', 12, 'bonus', 2),
    jsonb_build_object('count', 24, 'bonus', 4), jsonb_build_object('count', 48, 'bonus', 8))),
  'group_benchmark', jsonb_build_object('min_size', 5),
  'enabled', jsonb_build_object('training', true, 'match', true, 'series', true, 'manual', true, 'benchmark', true)
), 'Стартовая версия по Issue #18 (согласовано 2026-11-04)'
from (select id from clubs order by id limit 1) c
on conflict (club_id, effective_from) do nothing;

commit;
