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
  created_at timestamptz not null default now(),
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
language plpgsql set search_path = public as $$
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

-- 3а. Согласие нельзя создать без связи: состояние и событие принимаются только для пары «этот родитель и этот ребёнок»,
--     у которой есть связь (player_guardians, в том числе со старым отзывом, чтобы родитель мог принять заново без повторной
--     привязки) либо действующий запрос на связь (pending или approved). Защита на уровне данных, она действует для любой роли.
create or replace function parental_consent_link_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not (
    exists (select 1 from player_guardians where user_id = new.parent_user_id and player_id = new.player_id)
    or exists (select 1 from link_requests where user_id = new.parent_user_id and player_id = new.player_id and status in ('pending', 'approved'))
  ) then
    raise exception 'no guardian link for this parent and child' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger parental_consents_link_guard before insert on parental_consents
  for each row execute function parental_consent_link_guard();
create trigger parental_consent_events_link_guard before insert on parental_consent_events
  for each row execute function parental_consent_link_guard();

-- 4. Текущая версия типа: принимаемая версия с самой поздней датой вступления (уже наступившей).
create or replace function consent_current_version(t text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from consent_doc_versions
   where consent_type = t and accepting and effective_from <= now()
   order by effective_from desc, created_at desc, id desc
   limit 1
$$;

-- 5. Внутренний предикат: у родителя по ребёнку действует подтверждение именно текущей версии типа.
--    Нет текущей версии, нет строки, статус не granted или версия устарела — согласия нет.
--    Снаружи не вызывается; используют серверные функции следующих этапов.
create or replace function has_consent(parent uuid, player uuid, t text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select pc.status = 'granted' and pc.version_id = consent_current_version(t)
      from parental_consents pc
     where pc.parent_user_id = parent and pc.player_id = player and pc.consent_type = t
  ), false)
$$;

-- 6. Предикат для политик и функций: у текущего пользователя действует обязательное согласие по ребёнку.
create or replace function my_data_consent_ok(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select current_user_id() is not null and has_consent(current_user_id(), p, 'data_processing')
$$;

revoke execute on function consent_current_version(text), has_consent(uuid, uuid, text), my_data_consent_ok(uuid), parental_consent_events_immutable(), parental_consent_link_guard() from public, anon, authenticated;
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
