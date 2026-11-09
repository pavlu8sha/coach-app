-- 0169 (Issue #470, этап 5): документы сбора. Условия приёмки: docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md (37-38, 34).
-- Файлы (только PDF, до 10 МБ) лежат в закрытом хранилище camp-docs; политик чтения у хранилища нет, поэтому напрямую
-- файл не получает никто. Загрузку и выдачу делает Edge Function camp-docs:
--  * загрузка: camp_document_begin (администратор, от его имени) -> проверка файла -> запись в хранилище сервисным ключом
--    -> camp_document_finish (только сервер);
--  * выдача: camp_document_path (от имени пользователя, права проверяет база) -> ссылка на 60 секунд.
-- Документ: цепочка версий (doc_id). Участник видит только последнюю загруженную версию неснятого документа.
-- Доступ: родитель (с действующим согласием) игрока со статусом registered, владелец гостевой записи со статусом registered,
-- администратор, локальный администратор места сбора. Заявка без решения, отменённая и отказанная запись доступа не дают.
-- Строки документов не удаляются: снятие и замена остаются в истории. Сбор с документами удалить нельзя.

create table if not exists camp_documents (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references camps(id) on delete restrict,
  doc_id uuid not null,
  version int not null check (version >= 1),
  title text not null check (length(title) between 1 and 120),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references users(id) on delete set null,
  unique (doc_id, version)
);
create index if not exists camp_documents_camp_idx on camp_documents (camp_id, doc_id);

alter table camp_documents enable row level security;
revoke all on camp_documents from public, anon, authenticated, service_role;
grant select on camp_documents to service_role;

-- Закрытое хранилище. В проверочной базе схемы storage нет, там блок пропускается.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('camp-docs', 'camp-docs', false, 10485760, array['application/pdf'])
      on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf']
    $q$;
  end if;
end $$;

-- Подтверждённый участник сбора: родитель записанного игрока (согласие не отозвано) или владелец записанной гостевой записи
create or replace function camp_is_confirmed(cid uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select u is not null and exists (
    select 1 from camp_participants cp
     where cp.camp_id = cid and cp.status = 'registered'
       and (cp.owner_user_id = u
            or exists (select 1 from player_guardians g where g.player_id = cp.player_id and g.user_id = u and g.consent_revoked_at is null)))
$$;

create or replace function camp_documents_can_read(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or is_location_admin(camp_location(cid)) or camp_is_confirmed(cid, current_user_id())
$$;

-- Текущая версия документа: последняя загруженная версия неснятой цепочки
create or replace function camp_document_is_current(d camp_documents) returns boolean
language sql stable security definer set search_path = public as $$
  select d.status = 'ready' and d.removed_at is null
     and not exists (select 1 from camp_documents n where n.doc_id = d.doc_id and n.status = 'ready' and n.version > d.version)
$$;

-- ===== Начало загрузки (администратор) =====
-- replaces: любая версия заменяемого документа; новая строка получает следующий номер версии.
create or replace function camp_document_begin(cid uuid, title text, size bigint, replaces uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text := btrim(regexp_replace(coalesce(title, ''), '[[:cntrl:]​⁠﻿]', '', 'g'));
        g uuid; v int := 1; r camp_documents; nid uuid := gen_random_uuid();
begin
  perform camp_assert_admin();
  if t = '' or length(t) > 120 or size is null or size < 1 or size > 10485760 then
    raise exception 'bad document' using errcode = '22023';
  end if;
  perform 1 from camps where id = cid for update;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
  -- Брошенные загрузки (старше часа) считаются сорвавшимися
  update camp_documents set status = 'failed' where camp_id = cid and status = 'pending' and created_at < now() - interval '1 hour';
  if replaces is not null then
    select * into r from camp_documents where id = replaces;
    if not found or r.camp_id <> cid or r.removed_at is not null then raise exception 'bad document' using errcode = '22023'; end if;
    g := r.doc_id;
    -- Побеждает последняя начатая замена: прежние незавершённые загрузки этого документа считаются сорвавшимися
    update camp_documents set status = 'failed' where doc_id = g and status = 'pending';
    select max(version) + 1 into v from camp_documents where doc_id = g;
  else
    g := gen_random_uuid();
    if (select count(distinct doc_id) from camp_documents where camp_id = cid and removed_at is null and status in ('pending', 'ready')) >= 20 then
      raise exception 'too many documents' using errcode = '22023';
    end if;
  end if;
  if (select count(*) from camp_documents where camp_id = cid and created_at > now() - interval '1 day') >= 60 then
    raise exception 'too many documents' using errcode = '22023';
  end if;
  insert into camp_documents (id, camp_id, doc_id, version, title, size_bytes, storage_path, uploaded_by)
  values (nid, cid, g, v, t, size, cid::text || '/' || nid::text || '.pdf', current_user_id());
  return jsonb_build_object('id', nid, 'path', cid::text || '/' || nid::text || '.pdf');
end $$;

-- ===== Завершение загрузки (только сервер) =====
-- ok = true: файл записан в хранилище, версия становится видимой, участникам уходит сообщение (если camps.notify включён).
create or replace function camp_document_finish(did uuid, ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d camp_documents; c camps; u uuid; msg text;
begin
  select * into d from camp_documents where id = did;
  if not found then raise exception 'not pending' using errcode = '22023'; end if;
  perform 1 from camps where id = d.camp_id for update;
  select * into d from camp_documents where id = did for update;
  if d.status <> 'pending' then raise exception 'not pending' using errcode = '22023'; end if;
  if not coalesce(ok, false) then
    update camp_documents set status = 'failed' where id = did;
    return;
  end if;
  -- Брошенная загрузка (старше часа) не публикуется; строку пометит сорвавшейся следующая загрузка
  if d.created_at < now() - interval '1 hour' then raise exception 'not pending' using errcode = '22023'; end if;
  update camp_documents set status = 'ready', ready_at = now() where id = did;
  if d.removed_at is not null then return; end if;
  -- Ошибка уведомления публикацию не отменяет. На один документ не больше трёх сообщений за сутки.
  begin
    select * into c from camps where id = d.camp_id;
    if not camp_notify_enabled(c.club_id) then return; end if;
    if (select count(*) from camp_documents where doc_id = d.doc_id and status = 'ready' and ready_at > now() - interval '1 day') > 3 then return; end if;
    msg := 'Сбор «' || c.name || '»: ' || case when d.version = 1 then 'опубликован' else 'обновлён' end
      || ' документ «' || d.title || E'».\nОткройте приложение, раздел «Сборы».';
    for u in
      select distinct x.uid from (
        select cp.owner_user_id as uid from camp_participants cp
         where cp.camp_id = d.camp_id and cp.status = 'registered' and cp.owner_user_id is not null
        union
        select g.user_id from camp_participants cp join player_guardians g on g.player_id = cp.player_id
         where cp.camp_id = d.camp_id and cp.status = 'registered' and g.consent_revoked_at is null) x
    loop
      -- не больше пяти сообщений о документах одному человеку за сутки
      continue when (select count(*) from notifications n where n.user_id = u and n.kind = 'camp_document' and n.created_at > now() - interval '1 day') >= 5;
      perform enqueue_notification(u, 'camp_document', msg);
    end loop;
  exception when others then
    raise warning 'camp_document_finish: %', sqlerrm;
  end;
end $$;

-- ===== Чтение =====
create or replace function camp_documents_list(cid uuid)
returns table (id uuid, title text, version int, size_bytes bigint, ready_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null or not camp_documents_can_read(cid) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select d.id, d.title, d.version, d.size_bytes, d.ready_at from camp_documents d
     where d.camp_id = cid and camp_document_is_current(d)
     order by d.title, d.ready_at;
end $$;

create or replace function camp_document_admin_list(cid uuid)
returns table (id uuid, doc_id uuid, title text, version int, status text, size_bytes bigint, storage_path text,
               uploaded_by uuid, created_at timestamptz, ready_at timestamptz, removed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform camp_assert_admin();
  return query
    select d.id, d.doc_id, d.title, d.version, d.status, d.size_bytes, d.storage_path, d.uploaded_by, d.created_at, d.ready_at, d.removed_at
      from camp_documents d where d.camp_id = cid order by d.created_at desc, d.version desc;
end $$;

-- Путь к файлу для выдачи ссылки. Отказ одинаков для чужого, снятого, незагруженного и несуществующего документа.
-- Администратор получает путь и к прежним версиям, остальные только к текущей.
create or replace function camp_document_path(did uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare d camp_documents;
begin
  select * into d from camp_documents where id = did;
  if found and current_user_id() is not null and d.status = 'ready' then
    if is_admin() then return d.storage_path; end if;
    if camp_documents_can_read(d.camp_id) and camp_document_is_current(d) then return d.storage_path; end if;
  end if;
  raise exception 'forbidden' using errcode = '42501';
end $$;

-- ===== Снятие документа (администратор): скрываются все версии, строки остаются =====
create or replace function camp_document_remove(did uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d camp_documents;
begin
  perform camp_assert_admin();
  select * into d from camp_documents where id = did;
  if not found then raise exception 'document not found' using errcode = 'P0002'; end if;
  perform 1 from camps where id = d.camp_id for update;
  update camp_documents set removed_at = now(), removed_by = current_user_id() where doc_id = d.doc_id and removed_at is null;
end $$;

-- Строки документов не удаляются и не очищаются
create or replace function camp_documents_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'immutable' using errcode = 'P0001';
end $$;
drop trigger if exists camp_documents_no_delete on camp_documents;
create trigger camp_documents_no_delete before delete on camp_documents for each row execute function camp_documents_guard();
drop trigger if exists camp_documents_no_truncate on camp_documents;
create trigger camp_documents_no_truncate before truncate on camp_documents for each statement execute function camp_documents_guard();

revoke execute on function camp_is_confirmed(uuid, uuid), camp_documents_can_read(uuid), camp_document_is_current(camp_documents),
  camp_document_begin(uuid, text, bigint, uuid), camp_document_finish(uuid, boolean), camp_documents_list(uuid),
  camp_document_admin_list(uuid), camp_document_path(uuid), camp_document_remove(uuid), camp_documents_guard()
  from public, anon, authenticated, service_role;
grant execute on function camp_document_begin(uuid, text, bigint, uuid), camp_documents_list(uuid), camp_document_admin_list(uuid),
  camp_document_path(uuid), camp_document_remove(uuid) to authenticated;
grant execute on function camp_document_finish(uuid, boolean) to service_role;
