-- 0159 (#238, PR 1): модель двух независимых согласий родителя.
--   data_processing   — обязательное согласие на обработку персональных данных;
--   media_publication — добровольное согласие на публикацию фото, видео, имени, фамилии и достижений ребёнка.
-- Только модель данных: версии по типам, текущее состояние, неизменяемая история и серверный предикат.
-- Эта миграция НИЧЕГО не меняет в поведении приложения: старые функции и политики (is_guardian_of, group_parents,
-- request_link, decide_link, revoke_consent и др.) не тронуты и по-прежнему смотрят на player_guardians.consent_*.
-- Данные не переносятся и не создаются: у существующих связей «ожидание» выводится представлением из отсутствия строки
-- состояния, а старые consent_version / consent_given_at / consent_revoked_at остаются как исторические сведения.
-- Версии согласий здесь не заводятся: утверждённые тексты (по типам) пока не определены, версии добавляются отдельно.

-- 1. Версии: каждая версия принадлежит одному типу согласия.
--    accepting — версию можно принимать сейчас; текущей считается принимаемая версия с самой поздней датой вступления.
create table consent_doc_versions (
  id uuid primary key default gen_random_uuid(),
  consent_type text not null check (consent_type in ('data_processing', 'media_publication')),
  version text not null check (length(btrim(version)) between 1 and 80),
  text_ref text,
  effective_from timestamptz not null default now(),
  accepting boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  unique (consent_type, version),
  unique (id, consent_type)
);
alter table consent_doc_versions enable row level security;
revoke all on consent_doc_versions from public, anon, authenticated;
grant select on consent_doc_versions to authenticated;
grant select, insert, update on consent_doc_versions to service_role;
create policy consent_doc_versions_read on consent_doc_versions for select using (current_user_id() is not null);

-- 2. История: только дописывается. Каждое подтверждение и каждый отзыв — отдельная запись.
--    Внешние ключи без каскада: строки истории не исчезают вместе с пользователем или ребёнком.
create table parental_consent_events (
  id bigint generated always as identity primary key,
  parent_user_id uuid not null references users(id),
  player_id uuid not null references players(id),
  consent_type text not null check (consent_type in ('data_processing', 'media_publication')),
  version_id uuid not null,
  event text not null check (event in ('granted', 'revoked')),
  occurred_at timestamptz not null default now(),
  actor_id uuid references users(id),
  source text not null check (source in ('app', 'admin', 'system')),
  -- версия обязана принадлежать тому же типу согласия
  foreign key (version_id, consent_type) references consent_doc_versions (id, consent_type)
);
create index parental_consent_events_parent_idx on parental_consent_events (parent_user_id, player_id, consent_type, id);
alter table parental_consent_events enable row level security;
revoke all on parental_consent_events from public, anon, authenticated;
grant select on parental_consent_events to authenticated;
grant select, insert on parental_consent_events to service_role;
create policy parental_consent_events_read on parental_consent_events for select
  using (is_admin() or parent_user_id = current_user_id());

create or replace function parental_consent_events_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'consent history is append-only' using errcode = '42501';
end $$;
create trigger parental_consent_events_no_change before update or delete on parental_consent_events
  for each row execute function parental_consent_events_immutable();
create trigger parental_consent_events_no_truncate before truncate on parental_consent_events
  for each statement execute function parental_consent_events_immutable();

-- 3. Текущее состояние: одна строка на родитель + ребёнок + тип. Отсутствие строки = согласия нет.
create table parental_consents (
  id uuid primary key default gen_random_uuid(),
  parent_user_id uuid not null references users(id),
  player_id uuid not null references players(id),
  consent_type text not null check (consent_type in ('data_processing', 'media_publication')),
  version_id uuid,
  status text not null default 'pending' check (status in ('pending', 'granted', 'revoked')),
  granted_at timestamptz,
  revoked_at timestamptz,
  last_actor_id uuid references users(id),
  last_event_id bigint references parental_consent_events(id),
  updated_at timestamptz not null default now(),
  unique (parent_user_id, player_id, consent_type),
  foreign key (version_id, consent_type) references consent_doc_versions (id, consent_type),
  -- granted и revoked обязаны ссылаться на версию и событие истории
  check (status = 'pending' or (version_id is not null and last_event_id is not null)),
  check (status <> 'granted' or granted_at is not null),
  check (status <> 'revoked' or revoked_at is not null)
);
alter table parental_consents enable row level security;
revoke all on parental_consents from public, anon, authenticated;
grant select on parental_consents to authenticated;
grant select, insert, update on parental_consents to service_role;
create policy parental_consents_read on parental_consents for select
  using (is_admin() or parent_user_id = current_user_id());

-- 3а. Защита данных на уровне триггеров (действует для любой роли, в том числе service_role).
--  а) Согласие создаётся только по существующей связи ЭТОГО родителя с этим ребёнком (player_guardians, в том числе
--     со старым отзывом: родитель может принять заново без новой привязки). Запрос на связь (link_requests) связью не считается;
--     для новой привязки согласие принимается после одобрения связи. Строка связи блокируется на время транзакции,
--     чтобы её нельзя было удалить параллельно.
--  б) Подтверждение (granted) принимается только для версии своего типа, которую можно принимать сейчас.
--  в) Строка состояния принадлежит своей паре родитель + ребёнок + тип навсегда и ссылается на последнее собственное событие
--     истории с тем же статусом и той же версией.
--  г) У версии нельзя менять тип, название, дату вступления; текст-ссылку можно задать один раз.
create or replace function parental_consent_link_check(parent uuid, player uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from player_guardians where user_id = parent and player_id = player for key share;
  if not found then raise exception 'no guardian link for this parent and child' using errcode = '23503'; end if;
end $$;

create or replace function parental_consent_event_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v consent_doc_versions; vfound boolean;
begin
  select * into v from consent_doc_versions where id = new.version_id;
  vfound := found;
  if vfound and v.consent_type <> new.consent_type then
    raise exception 'version belongs to another consent type' using errcode = '23503';
  end if;
  -- подтверждение требует связи; отзыв записывается всегда, если по этой паре и типу уже есть собственная история
  -- (связь могла исчезнуть: erase_parent, удаление администратором), иначе тоже требует связи
  if new.event = 'granted' or not exists (
       select 1 from parental_consent_events x
        where x.parent_user_id = new.parent_user_id and x.player_id = new.player_id and x.consent_type = new.consent_type) then
    perform parental_consent_link_check(new.parent_user_id, new.player_id);
  end if;
  if vfound and new.event = 'granted' and not (v.accepting and v.effective_from <= now()) then
    raise exception 'consent version is not accepted now' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger parental_consent_events_guard before insert on parental_consent_events
  for each row execute function parental_consent_event_guard();

create or replace function parental_consent_state_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare e parental_consent_events;
begin
  if tg_op = 'UPDATE' then
    if (new.parent_user_id, new.player_id, new.consent_type) is distinct from (old.parent_user_id, old.player_id, old.consent_type) then
      raise exception 'consent state identity is immutable' using errcode = '42501';
    end if;
    if old.status <> 'pending' and new.status = 'pending' then
      raise exception 'consent state cannot return to pending' using errcode = '23514';
    end if;
    if new.last_event_id is not distinct from old.last_event_id
       and (new.status, new.version_id, new.granted_at, new.revoked_at) is distinct from (old.status, old.version_id, old.granted_at, old.revoked_at) then
      raise exception 'state changes require a new history event' using errcode = '23514';
    end if;
  else
    perform parental_consent_link_check(new.parent_user_id, new.player_id);
  end if;
  if new.last_event_id is not null then
    select * into e from parental_consent_events where id = new.last_event_id;
    if not found
       or (e.parent_user_id, e.player_id, e.consent_type) is distinct from (new.parent_user_id, new.player_id, new.consent_type)
       or e.event is distinct from new.status
       or e.version_id is distinct from new.version_id
       or exists (select 1 from parental_consent_events x
                   where x.parent_user_id = e.parent_user_id and x.player_id = e.player_id and x.consent_type = e.consent_type and x.id > e.id) then
      raise exception 'state must follow the latest own history event' using errcode = '23514';
    end if;
    if (new.status = 'granted' and new.granted_at is distinct from e.occurred_at)
       or (new.status = 'revoked' and new.revoked_at is distinct from e.occurred_at) then
      raise exception 'state time must equal the history event time' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger parental_consents_guard before insert or update on parental_consents
  for each row execute function parental_consent_state_guard();

create or replace function consent_doc_versions_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.id, new.consent_type, new.created_at) is distinct from (old.id, old.consent_type, old.created_at) then
    raise exception 'consent version type and identity are immutable' using errcode = '42501';
  end if;
  -- пока версию никто не подтвердил, название и дату вступления можно исправить;
  -- после первого события истории они неизменны, ссылку на текст можно задать один раз
  if (new.version, new.effective_from) is distinct from (old.version, old.effective_from)
     and exists (select 1 from parental_consent_events where version_id = old.id) then
    raise exception 'consent version is immutable (only accepting and a first text_ref can change)' using errcode = '42501';
  end if;
  if old.text_ref is not null and new.text_ref is distinct from old.text_ref then
    raise exception 'consent version is immutable (only accepting and a first text_ref can change)' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger consent_doc_versions_no_rewrite before update on consent_doc_versions
  for each row execute function consent_doc_versions_guard();

-- 4. Текущая версия типа: принимаемая версия с самой поздней датой вступления (уже наступившей).
create or replace function consent_current_version(t text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from consent_doc_versions
   where consent_type = t and accepting and effective_from <= now()
   order by effective_from desc, created_at desc, id desc
   limit 1
$$;

-- 5. Внутренний предикат: у родителя по ребёнку действует подтверждение именно текущей версии типа.
--    Нет текущей версии, нет строки, статус не granted или версия устарела — согласия нет.
--    Снаружи не вызывается; используют серверные функции следующих этапов.
create or replace function has_consent(parent uuid, player uuid, t text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select pc.status = 'granted' and pc.version_id = consent_current_version(t)
      from parental_consents pc
     where pc.parent_user_id = parent and pc.player_id = player and pc.consent_type = t
  ), false)
  and exists (select 1 from player_guardians g where g.user_id = parent and g.player_id = player)
$$;

-- 6. Предикат для политик и функций: у текущего пользователя действует обязательное согласие по ребёнку.
create or replace function my_data_consent_ok(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select current_user_id() is not null and has_consent(current_user_id(), p, 'data_processing')
$$;

revoke execute on function consent_current_version(text), has_consent(uuid, uuid, text), my_data_consent_ok(uuid), parental_consent_events_immutable(), parental_consent_link_check(uuid, uuid), parental_consent_event_guard(), parental_consent_state_guard(), consent_doc_versions_guard() from public, anon, authenticated;
-- Для политик и представления: чужие данные они не раскрывают (текущая версия — общая для всех, предикат смотрит только на текущего пользователя).
grant execute on function my_data_consent_ok(uuid), consent_current_version(text) to authenticated;

-- 7. Статус для интерфейса и проверок: по каждой связи родитель–ребёнок и каждому типу.
--    «Ожидание» выводится из отсутствия строки состояния; ничего не записывается.
--    legacy_* — прежние сведения единого согласия, показываются как есть и ни за какой из новых типов не засчитываются.
--    Строки видят родитель (свои) и администратор — через политики базовых таблиц (security_invoker).
create view parental_consent_status with (security_invoker = true) as
  select pg.user_id as parent_user_id, pg.player_id, t.consent_type,
         coalesce(pc.status, 'pending') as status,
         pc.version_id, pc.granted_at, pc.revoked_at,
         coalesce(pc.status = 'granted' and pc.version_id = consent_current_version(t.consent_type), false) as is_current,
         pg.consent_version as legacy_consent_version,
         pg.consent_given_at as legacy_consent_given_at,
         pg.consent_revoked_at as legacy_consent_revoked_at
    from player_guardians pg
    cross join (values ('data_processing'::text), ('media_publication'::text)) as t(consent_type)
    left join parental_consents pc
      on pc.parent_user_id = pg.user_id and pc.player_id = pg.player_id and pc.consent_type = t.consent_type;
revoke all on parental_consent_status from public, anon, authenticated;
grant select on parental_consent_status to authenticated;
