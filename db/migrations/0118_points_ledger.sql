-- 0118: журнал начислений баллов (#18, этап 3). Только добавление: строки не удаляются, не получают отрицательных баллов,
-- а исправление = старая строка superseded + новая. Движок points_ledger_apply согласует журнал с ожидаемым набором начислений
-- события; повтор с теми же данными ничего не меняет. Источники (посещаемость, матчи, ручные баллы) подключаются следующими этапами.
-- Старые point_events, их функции и points_start не затрагиваются. Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

create table points_ledger (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  player_id uuid not null references players(id),
  group_id uuid references groups(id),                       -- тренировочная группа игрока на дату события; пусто, если не определена
  event_date date not null,                                  -- локальная дата клуба (Asia/Tbilisi)
  month date generated always as (event_date - (extract(day from event_date)::int - 1)) stored,
  source_type text not null check (source_type in ('group_session', 'individual', 'goalkeeper', 'extra', 'match', 'series_bonus', 'manual')),
  source_id uuid not null,
  reason_code text not null,
  points int not null check (points >= 0 and points <= 1000),
  components jsonb not null default '{}'::jsonb,
  rule_version_id uuid references points_rule_versions(id),
  status text not null default 'active' check (status in ('active', 'superseded', 'cancelled')),
  supersedes_id uuid references points_ledger(id),
  cancel_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'active') = (closed_at is null))
);
-- не больше одной действующей строки на игрока, источник и основание: это защита от дублей
create unique index points_ledger_one_active on points_ledger (player_id, source_type, source_id, reason_code) where status = 'active';
create index points_ledger_player_month on points_ledger (player_id, month) where status = 'active';
create index points_ledger_group_month on points_ledger (group_id, month) where status = 'active';
create index points_ledger_source on points_ledger (source_type, source_id);

create table points_ledger_audit (
  id bigint generated always as identity primary key,
  ledger_id uuid references points_ledger(id),
  source_type text not null,
  source_id uuid not null,
  action text not null check (action in ('create', 'supersede', 'cancel')),
  before jsonb,
  after jsonb,
  reason text,
  actor_id uuid references users(id),
  at timestamptz not null default now()
);
create index points_ledger_audit_source on points_ledger_audit (source_type, source_id);

alter table points_ledger enable row level security;
alter table points_ledger_audit enable row level security;

-- Читают: администратор и тренер игрока (все строки, включая исправленные), родитель и сам ребёнок (только действующие)
create policy points_ledger_read on points_ledger for select using (
  is_admin() or is_coach_of_player(player_id)
  or (status = 'active' and (is_guardian_of(player_id) or is_self_player(player_id)))
);
create policy points_ledger_audit_read on points_ledger_audit for select using (is_admin());

revoke all on points_ledger, points_ledger_audit from authenticated, anon;
grant select on points_ledger, points_ledger_audit to authenticated;
grant select, insert, update on points_ledger to service_role;
grant select, insert on points_ledger_audit to service_role;

-- Журнал неизменен: удалять нельзя; менять можно только закрытие строки (status active -> superseded/cancelled).
create or replace function points_ledger_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'points ledger rows cannot be deleted' using errcode = '42501';
  end if;
  if old.status <> 'active' then
    raise exception 'closed points ledger row cannot be changed' using errcode = '42501';
  end if;
  if new.status = 'active'
     -- month: вычисляемая колонка, в BEFORE-триггере у new она ещё пуста
     or (to_jsonb(new) - 'status' - 'cancel_reason' - 'closed_at' - 'month') <> (to_jsonb(old) - 'status' - 'cancel_reason' - 'closed_at' - 'month') then
    raise exception 'points ledger row can only be closed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger points_ledger_no_change before update or delete on points_ledger
  for each row execute function points_ledger_guard();

create or replace function points_ledger_audit_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'points ledger audit is append-only' using errcode = '42501';
end $$;
create trigger points_ledger_audit_no_change before update or delete on points_ledger_audit
  for each row execute function points_ledger_audit_guard();

-- Движок согласования. Служебная функция: вызывается только изнутри функций источников, приложению недоступна.
-- expected: массив [{player_id, group_id, event_date, reason_code, points, components, rule_version_id}, ...]
-- Для источника (source_type, source_id) приводит действующие строки журнала к expected:
--   нет строки -> create; изменились данные -> старая superseded + новая; строки нет в expected -> cancelled.
-- Возвращает число изменений. Повтор с теми же данными возвращает 0 и ничего не пишет.
create or replace function points_ledger_apply(c uuid, st text, sid uuid, expected jsonb, why text default null) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; cur points_ledger; nid uuid; changed int := 0; actor uuid := current_user_id();
        keys text[] := '{}'; k text;
begin
  if jsonb_typeof(expected) is distinct from 'array' then raise exception 'expected must be an array' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('points_ledger:' || st || ':' || sid::text));

  for e in select * from jsonb_array_elements(expected) loop
    k := (e ->> 'player_id') || '|' || (e ->> 'reason_code');
    if k = any (keys) then raise exception 'duplicate expected entry %', k using errcode = '22023'; end if;
    keys := keys || k;
    select * into cur from points_ledger
      where player_id = (e ->> 'player_id')::uuid and source_type = st and source_id = sid
        and reason_code = e ->> 'reason_code' and status = 'active';
    if cur.id is not null
       and cur.points = (e ->> 'points')::int
       and cur.group_id is not distinct from nullif(e ->> 'group_id', '')::uuid
       and cur.event_date = (e ->> 'event_date')::date
       and cur.components = coalesce(e -> 'components', '{}'::jsonb)
       and cur.rule_version_id is not distinct from nullif(e ->> 'rule_version_id', '')::uuid then
      continue;
    end if;
    if cur.id is not null then
      update points_ledger set status = 'superseded', closed_at = now(), cancel_reason = why where id = cur.id;
    end if;
    insert into points_ledger (club_id, player_id, group_id, event_date, source_type, source_id, reason_code, points, components,
                               rule_version_id, supersedes_id, created_by)
      values (c, (e ->> 'player_id')::uuid, nullif(e ->> 'group_id', '')::uuid, (e ->> 'event_date')::date, st, sid, e ->> 'reason_code',
              (e ->> 'points')::int, coalesce(e -> 'components', '{}'::jsonb), nullif(e ->> 'rule_version_id', '')::uuid, cur.id, actor)
      returning id into nid;
    insert into points_ledger_audit (ledger_id, source_type, source_id, action, before, after, reason, actor_id)
      values (nid, st, sid, case when cur.id is null then 'create' else 'supersede' end,
              case when cur.id is null then null else jsonb_build_object('points', cur.points, 'group_id', cur.group_id, 'event_date', cur.event_date, 'components', cur.components) end,
              jsonb_build_object('points', (e ->> 'points')::int, 'group_id', nullif(e ->> 'group_id', ''), 'event_date', e ->> 'event_date', 'components', coalesce(e -> 'components', '{}'::jsonb)),
              why, actor);
    changed := changed + 1;
  end loop;

  for cur in select * from points_ledger where source_type = st and source_id = sid and status = 'active' loop
    if (cur.player_id::text || '|' || cur.reason_code) = any (keys) then continue; end if;
    update points_ledger set status = 'cancelled', closed_at = now(), cancel_reason = coalesce(why, 'source_changed') where id = cur.id;
    insert into points_ledger_audit (ledger_id, source_type, source_id, action, before, reason, actor_id)
      values (cur.id, st, sid, 'cancel', jsonb_build_object('points', cur.points, 'group_id', cur.group_id, 'event_date', cur.event_date, 'components', cur.components),
              coalesce(why, 'source_changed'), actor);
    changed := changed + 1;
  end loop;
  return changed;
end $$;
revoke execute on function points_ledger_apply(uuid, text, uuid, jsonb, text) from public, anon, authenticated;

commit;
