-- 0161 (Issue #470, этап 2): гостевые заявки на сборы. Условия приёмки: docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md (22-27).
--  * camp_applications: заявка родителя ребёнка, который ещё не в клубе (данные хранятся отдельно от игроков клуба);
--    статус «new» не занимает место, не участник, не попадает в списки, долги и кассу;
--  * camp_apply: подача заявки вошедшим пользователем (Telegram-аккаунт из доверенного входа, tg-auth);
--  * camp_application_decide: подтверждение (гостевой участник, повторная проверка лимита) или отказ, только администратор;
--  * camp_participants.owner_user_id: владелец гостевой записи; после подтверждения гость читает свою запись, платежи, журнал,
--    сбор, тарифы и условия отмены. Игрок клуба для гостя не создаётся.
-- Заявки пишутся только функциями (прямых прав на запись нет). Читает владелец и администратор (не локальный администратор).

create table camp_applications (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references camps(id),
  owner_user_id uuid not null references users(id),
  child_name text not null check (length(child_name) between 2 and 80),
  child_birth date not null,
  parent_name text not null check (length(parent_name) between 2 and 80),
  parent_phone text not null check (length(parent_phone) between 5 and 30 and parent_phone ~ '^[0-9+()\- ]+$'),
  tariff_id uuid not null references camp_tariffs(id),
  comment text check (comment is null or length(comment) <= 500),
  status text not null default 'new' check (status in ('new', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  participant_id uuid references camp_participants(id)
);
create index camp_applications_camp on camp_applications (camp_id, status);
create index camp_applications_owner on camp_applications (owner_user_id, camp_id);
-- Один и тот же ребёнок (имя без учёта регистра и лишних пробелов + дата рождения) подаёт на сбор одну активную заявку
create unique index camp_applications_child_active on camp_applications
  (camp_id, lower(regexp_replace(btrim(child_name), '\s+', ' ', 'g')), child_birth) where status in ('new', 'approved');

alter table camp_applications enable row level security;
revoke all on camp_applications from public, anon, authenticated;
grant select on camp_applications to authenticated;
grant select on camp_applications to service_role;
create policy camp_applications_read on camp_applications for select
  using (is_admin() or owner_user_id = current_user_id());

alter table camp_participants add column if not exists owner_user_id uuid references users(id);
alter table camp_participants drop constraint if exists camp_participants_owner_guest_check;
alter table camp_participants add constraint camp_participants_owner_guest_check check (owner_user_id is null or player_id is null);

-- Владелец гостевой записи (для политик и camp_has_my_child)
create or replace function camp_owns_participant(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from camp_participants where id = pid and owner_user_id = current_user_id())
$$;
revoke execute on function camp_owns_participant(uuid) from public, anon;
grant execute on function camp_owns_participant(uuid) to authenticated;

create policy camp_participants_owner_read on camp_participants for select using (owner_user_id = current_user_id());
create policy camp_payments_owner_read on camp_payments for select using (camp_owns_participant(participant_id));
create policy camp_participant_events_owner_read on camp_participant_events for select using (camp_owns_participant(participant_id));

-- История гостя, как у родителя (0160): сбор, тарифы, условия остаются доступны владельцу записи
create or replace function camp_has_my_child(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from camp_participants cp
                  where cp.camp_id = cid
                    and (cp.owner_user_id = current_user_id()
                         or exists (select 1 from player_guardians g where g.player_id = cp.player_id and g.user_id = current_user_id() and g.consent_revoked_at is null)))
$$;

-- ===== Подача заявки =====
create or replace function camp_apply(cid uuid, child text, birth date, parent text, phone text, tid uuid, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := current_user_id(); c camps; cn text := regexp_replace(btrim(coalesce(child, '')), '\s+', ' ', 'g'); pn text := btrim(coalesce(parent, ''));
        ph text := btrim(coalesce(phone, '')); cm text := nullif(btrim(cmt), ''); r uuid;
begin
  if u is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from camps where id = cid;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
  if not c.active or c.ends_on < (now() at time zone 'Asia/Tbilisi')::date then raise exception 'camp closed' using errcode = '22023'; end if;
  if length(cn) not between 2 and 80 or length(pn) not between 2 and 80 or length(ph) not between 5 and 30 or ph !~ '^[0-9+()\- ]+$'
     or birth is null or birth > (now() at time zone 'Asia/Tbilisi')::date or birth < date '2000-01-01' or length(coalesce(cm, '')) > 500 then
    raise exception 'bad application' using errcode = '22023';
  end if;
  if not exists (select 1 from camp_tariffs where id = tid and camp_id = cid and active) then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  -- Подача одним пользователем на один сбор идёт по очереди: лимит и дубли проверяются без гонки
  perform pg_advisory_xact_lock(hashtextextended(cid::text || u::text, 0));
  if (select count(*) from camp_applications where camp_id = cid and owner_user_id = u and status = 'new') >= 3 then
    raise exception 'too many applications' using errcode = '22023';
  end if;
  if exists (select 1 from camp_applications where camp_id = cid and status in ('new', 'approved')
              and lower(regexp_replace(btrim(child_name), '\s+', ' ', 'g')) = lower(cn) and child_birth = birth) then
    raise exception 'already applied' using errcode = '23505';
  end if;
  insert into camp_applications (camp_id, owner_user_id, child_name, child_birth, parent_name, parent_phone, tariff_id, comment)
  values (cid, u, cn, birth, pn, ph, tid, cm) returning id into r;
  return r;
end $$;

-- ===== Решение администратора =====
-- approve = true: гостевой участник (место проверяется повторно под блокировкой сбора), approve = false: отказ.
-- Возвращает id участника (подтверждение) или null (отказ). Повторное решение отклоняется.
create or replace function camp_application_decide(aid uuid, approve boolean, note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a camp_applications; r uuid; nt text := nullif(btrim(note), '');
begin
  perform camp_assert_admin();
  if approve is null then raise exception 'bad decision' using errcode = '22023'; end if;
  if length(coalesce(nt, '')) > 500 then raise exception 'bad note' using errcode = '22023'; end if;
  select * into a from camp_applications where id = aid for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.status <> 'new' then raise exception 'already decided' using errcode = '22023'; end if;
  if approve then
    -- camp_register_guest берёт блокировку сбора, проверяет лимит и тариф, пишет журнал
    r := camp_register_guest(a.camp_id, a.child_name, left(a.parent_name, 45) || ', ' || a.parent_phone, a.tariff_id, null, null, a.comment);
    update camp_participants set owner_user_id = a.owner_user_id where id = r;
    update camp_applications set status = 'approved', decided_by = current_user_id(), decided_at = now(), decision_note = nt, participant_id = r where id = aid;
    return r;
  end if;
  update camp_applications set status = 'rejected', decided_by = current_user_id(), decided_at = now(), decision_note = nt where id = aid;
  return null;
end $$;

revoke execute on function camp_apply(uuid, text, date, text, text, uuid, text), camp_application_decide(uuid, boolean, text) from public, anon;
grant execute on function camp_apply(uuid, text, date, text, text, uuid, text), camp_application_decide(uuid, boolean, text) to authenticated;
