-- 0161 (#238, PR 2a): запись согласий. Номер 0160 занят задачей #470 (сборы).
-- Серверные функции принятия и отзыва двух независимых согласий, атомарная запись истории и состояния,
-- обработка разрыва и пересоздания связи. Условия приёмки: docs/CONSENT_PR2A_ACCEPTANCE.md.
-- Требует миграцию 0159 (модель согласий). Поведение доступа НЕ меняется: старые политики и функции
-- (is_guardian_of, group_parents, revoke_consent, request_link, retry_link и др.) не тронуты, режим не включается, backfill нет.
-- Старые поля player_guardians.consent_version / consent_given_at / consent_revoked_at не изменяются ни одной функцией этой миграции.
--
-- Порядок блокировок во всех путях (по возрастанию номера, обратно не ждём):
--   0. advisory-блокировка согласий (один ключ на все типы): SHARED у принятия, отзыва, записи события и удаления связи,
--      EXCLUSIVE у любой вставки/правки версий. Берётся триггером BEFORE STATEMENT или первой строкой функции, то есть ДО блокировки строк
--      (блокировка в BEFORE ROW сработала бы после блокировки строки и порядка не гарантировала бы);
--   1. строка связи player_guardians (for key share);  2. строка версии (for share);  3. строка состояния (for update);  4. вставка события.
-- Следствие: правка версий не пересекается ни с одной записью согласия (ждёт её завершения и наоборот), а между собой записи
-- упорядочены по связи и состоянию. Не смешивать в одной транзакции принятие согласия и правку версий (повышение shared до exclusive
-- одной транзакцией при параллельной такой же даст дедлок); в приложении таких транзакций нет.

-- 1. Блокировка версий: до блокировки строк, для любой роли (в том числе service_role).
create or replace function consent_versions_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('parental_consent_model'));
  return null;
end $$;
drop trigger if exists consent_versions_lock on consent_doc_versions;
create trigger consent_versions_lock before insert or update on consent_doc_versions
  for each statement execute function consent_versions_lock();

-- Проверка инварианта версий больше не берёт блокировку сама (её берёт триггер выше, раньше блокировки строк).
create or replace function consent_doc_versions_keep_open() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cur uuid;
begin
  if not new.accepting and new.effective_from > now() then
    raise exception 'a consent version that is not in force yet must stay open for confirmations' using errcode = '23514';
  end if;
  cur := consent_current_version(new.consent_type);
  if cur is not null and not (select accepting from consent_doc_versions where id = cur) then
    raise exception 'the current consent version must stay open for confirmations' using errcode = '23514';
  end if;
  return null;
end $$;

-- 2. Удаление связи: общая блокировка до блокировки строк.
create or replace function consent_links_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock_shared(hashtext('parental_consent_model'));
  return null;
end $$;
drop trigger if exists consent_links_lock on player_guardians;
create trigger consent_links_lock before delete on player_guardians
  for each statement execute function consent_links_lock();

-- 3. Триггер события (PR 1) в едином порядке: общая блокировка, связь, версия.
create or replace function parental_consent_event_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v consent_doc_versions; vfound boolean;
begin
  perform pg_advisory_xact_lock_shared(hashtext('parental_consent_model'));
  -- подтверждение требует связи; отзыв записывается всегда, если по этой паре и типу уже есть собственная история
  -- (связь могла исчезнуть: erase_parent, удаление администратором), иначе тоже требует связи
  if new.event = 'granted' or not exists (
       select 1 from parental_consent_events x
        where x.parent_user_id = new.parent_user_id and x.player_id = new.player_id and x.consent_type = new.consent_type) then
    perform parental_consent_link_check(new.parent_user_id, new.player_id);
  end if;
  -- версия блокируется на время транзакции: пока событие не закоммичено, её название и дату вступления не изменить
  select * into v from consent_doc_versions where id = new.version_id for share;
  vfound := found;
  -- время события задаёт сервер, подставить своё нельзя
  new.occurred_at := now();
  if vfound and v.consent_type <> new.consent_type then
    raise exception 'version belongs to another consent type' using errcode = '23503';
  end if;
  if vfound and new.event = 'granted' and not (v.accepting and v.effective_from <= now()) then
    raise exception 'consent version is not accepted now' using errcode = '23514';
  end if;
  return new;
end $$;

-- 4. Внутренняя запись: событие и состояние в одной транзакции. Только для серверных функций (EXECUTE никому).
--    Идемпотентно: принятие той же версии и отзыв не принятого согласия ничего не пишут и возвращают null.
create or replace function consent_record(parent uuid, player uuid, t text, ev text, ver uuid, src text, actor uuid) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare st parental_consents; vid uuid; cur uuid; eid bigint; eat timestamptz;
begin
  perform pg_advisory_xact_lock_shared(hashtext('parental_consent_model'));                     -- 0
  perform 1 from player_guardians where user_id = parent and player_id = player for key share;     -- 1
  if ev = 'granted' then
    if not found then raise exception 'no guardian link for this parent and child' using errcode = '42501'; end if;
    cur := consent_current_version(t);
    if cur is null then raise exception 'no consent version in force' using errcode = '23514'; end if;
    if ver is distinct from cur then raise exception 'consent version changed' using errcode = '23514'; end if;
    vid := ver;
  else
    select version_id into vid from parental_consents where parent_user_id = parent and player_id = player and consent_type = t;
    if vid is null then return null; end if;   -- отзывать нечего
  end if;
  perform 1 from consent_doc_versions where id = vid for share;                                    -- 2
  if ev = 'granted' then
    insert into parental_consents (parent_user_id, player_id, consent_type) values (parent, player, t)
      on conflict (parent_user_id, player_id, consent_type) do nothing;
  end if;
  select * into st from parental_consents where parent_user_id = parent and player_id = player and consent_type = t for update;  -- 3
  if not found then return null; end if;
  if ev = 'granted' and st.status = 'granted' and st.version_id = vid then return null; end if;
  if ev = 'revoked' then
    if st.status <> 'granted' then return null; end if;   -- уже отозвано
    vid := st.version_id;
    perform 1 from consent_doc_versions where id = vid for share;
  end if;
  insert into parental_consent_events (parent_user_id, player_id, consent_type, version_id, event, actor_id, source)   -- 4
    values (parent, player, t, vid, ev, actor, src) returning id, occurred_at into eid, eat;
  update parental_consents set
      status = case ev when 'granted' then 'granted' else 'revoked' end,
      version_id = vid,
      granted_at = case when ev = 'granted' then eat else st.granted_at end,
      revoked_at = case when ev = 'revoked' then eat else st.revoked_at end,
      last_actor_id = actor, last_event_id = eid, updated_at = now()
    where id = st.id;
  return eid;
end $$;

-- 5. Публичные функции родителя.
create or replace function accept_consent(p uuid, t text, ver uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := current_user_id(); eid bigint;
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if t is null or t not in ('data_processing', 'media_publication') then raise exception 'unknown consent type' using errcode = '22023'; end if;
  eid := consent_record(me, p, t, 'granted', ver, 'app', me);
  if eid is not null then
    insert into audit_log (actor_id, action, entity, entity_id, after)
      values (me, 'consent_granted', 'parental_consents', p, jsonb_build_object('type', t, 'version_id', ver, 'event_id', eid));
  end if;
  return jsonb_build_object('changed', eid is not null, 'event_id', eid);
end $$;

create or replace function revoke_parent_consent(p uuid, t text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := current_user_id(); eid bigint;
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if t is null or t not in ('data_processing', 'media_publication') then raise exception 'unknown consent type' using errcode = '22023'; end if;
  eid := consent_record(me, p, t, 'revoked', null, 'app', me);
  if eid is not null then
    insert into audit_log (actor_id, action, entity, entity_id, after)
      values (me, 'consent_revoked', 'parental_consents', p, jsonb_build_object('type', t, 'event_id', eid));
  end if;
  return jsonb_build_object('changed', eid is not null, 'event_id', eid);
end $$;

-- 6. Разрыв связи (любым путём: erase_parent, администратор): отзыв по каждому принятому типу; по остальным событий нет.
create or replace function consent_on_link_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select consent_type from parental_consents
            where parent_user_id = old.user_id and player_id = old.player_id and status = 'granted' order by consent_type loop
    perform consent_record(old.user_id, old.player_id, r.consent_type, 'revoked', null, 'system', null);
  end loop;
  return null;
end $$;
drop trigger if exists consent_on_link_delete on player_guardians;
create trigger consent_on_link_delete after delete on player_guardians
  for each row execute function consent_on_link_delete();

-- 7. decide_link: поведение прежнее (0015) плюс отзыв оставшихся согласий при СОЗДАНИИ связи.
--    Подтверждение существующей связи своих согласий не отнимает. Новая привязка требует нового принятия.
create or replace function decide_link(r uuid, approve boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare req link_requests; created boolean; c record;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock_shared(hashtext('parental_consent_model'));
  update link_requests
     set status = case when approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = current_user_id()
   where id = r and status = 'pending'
   returning * into req;
  if req.id is null then raise exception 'request not found or already decided'; end if;
  if approve then
    insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
      values (req.player_id, req.user_id, coalesce(req.consent_version, 'link-request-v0'), coalesce(req.consent_given_at, now()))
      on conflict (player_id, user_id) do update
        set consent_revoked_at = null, consent_version = excluded.consent_version, consent_given_at = excluded.consent_given_at
      returning (xmax = 0) into created;
    if created then
      for c in select consent_type from parental_consents
                where parent_user_id = req.user_id and player_id = req.player_id and status = 'granted' order by consent_type loop
        perform consent_record(req.user_id, req.player_id, c.consent_type, 'revoked', null, 'system', current_user_id());
      end loop;
    end if;
  end if;
end $$;

-- 8. Права: внутренние функции никому, публичные только вошедшим.
revoke execute on function consent_record(uuid, uuid, text, text, uuid, text, uuid), consent_on_link_delete(), consent_versions_lock(), consent_links_lock()
  from public, anon, authenticated, service_role;
revoke execute on function accept_consent(uuid, text, uuid), revoke_parent_consent(uuid, text) from public, anon;
grant execute on function accept_consent(uuid, text, uuid), revoke_parent_consent(uuid, text) to authenticated;
