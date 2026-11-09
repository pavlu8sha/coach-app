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
-- Очистка имени: форма NFC, невидимые символы убираются, любые пробелы (в т.ч. неразрывный) сворачиваются в один, края обрезаются
create or replace function camp_clean_text(t text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(regexp_replace(normalize(coalesce(t, ''), NFC), '[\u200B-\u200D\u2060\uFEFF\u00AD]', '', 'g'), '[[:space:]\u00A0\u2000-\u200A\u202F\u205F\u3000]+', ' ', 'g'))
$$;
create or replace function camp_norm_name(t text) returns text
language sql immutable set search_path = public as $$ select lower(camp_clean_text(t)) $$;
-- Один и тот же ребёнок (имя без учёта регистра, пробелов и формы юникода + дата рождения) подаёт на сбор одну новую заявку.
-- Подтверждённая заявка блокирует повтор, только пока участник записан (проверка в camp_apply): после отказа или отмены можно подать снова.
create unique index camp_applications_child_active on camp_applications
  (camp_id, camp_norm_name(child_name), child_birth) where status = 'new';

alter table camp_applications enable row level security;
revoke all on camp_applications from public, anon, authenticated;
grant select on camp_applications to authenticated;
grant select on camp_applications to service_role;
create policy camp_applications_read on camp_applications for select
  using (is_admin() or owner_user_id = current_user_id());

alter table camp_participants add column if not exists owner_user_id uuid references users(id);
alter table camp_participants drop constraint if exists camp_participants_owner_guest_check;
alter table camp_participants add constraint camp_participants_owner_guest_check check (owner_user_id is null or player_id is null);

-- Владелец гостевой записи ставится при создании и дальше не меняется ни сбросом, ни переназначением (даже администратором)
create or replace function camp_participants_owner_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then raise exception 'immutable' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger camp_participants_owner_guard before update on camp_participants for each row execute function camp_participants_owner_guard();
revoke execute on function camp_participants_owner_guard() from public, anon, authenticated;

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
declare u uuid := current_user_id(); c camps; cn text := camp_clean_text(child); pn text := camp_clean_text(parent);
        ph text := btrim(coalesce(phone, '')); cm text := nullif(btrim(cmt), ''); r uuid;
begin
  if u is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from camps where id = cid;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
  if not c.active or c.ends_on < (now() at time zone 'Asia/Tbilisi')::date then raise exception 'camp closed' using errcode = '22023'; end if;
  if length(cn) not between 2 and 80 or length(pn) not between 2 and 80 or cn !~ '[[:alpha:]]' or pn !~ '[[:alpha:]]'
     or length(ph) not between 5 and 30 or ph !~ '^[0-9+()\- ]+$' or length(regexp_replace(ph, '\D', '', 'g')) < 5
     or birth is null or birth > (now() at time zone 'Asia/Tbilisi')::date or birth < date '2000-01-01' or length(coalesce(cm, '')) > 500 then
    raise exception 'bad application' using errcode = '22023';
  end if;
  if not exists (select 1 from camp_tariffs where id = tid and camp_id = cid and active) then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  -- Подача одним пользователем идёт по очереди: лимиты проверяются без гонки
  perform pg_advisory_xact_lock(hashtextextended('camp_apply' || u::text, 0));
  if (select count(*) from camp_applications where camp_id = cid and owner_user_id = u and status = 'new') >= 3 then
    raise exception 'too many applications' using errcode = '22023';
  end if;
  -- Общий суточный лимит на пользователя (защита от рассылки заявок по всем сборам)
  if (select count(*) from camp_applications where owner_user_id = u and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too many applications' using errcode = '22023';
  end if;
  -- Активная заявка на того же ребёнка: новая, либо подтверждённая, пока участник записан
  if exists (select 1 from camp_applications a left join camp_participants p on p.id = a.participant_id
              where a.camp_id = cid and camp_norm_name(a.child_name) = camp_norm_name(cn) and a.child_birth = birth
                and (a.status = 'new' or (a.status = 'approved' and p.status = 'registered'))) then
    raise exception 'already applied' using errcode = '23505';
  end if;
  begin
    insert into camp_applications (camp_id, owner_user_id, child_name, child_birth, parent_name, parent_phone, tariff_id, comment)
    values (cid, u, cn, birth, pn, ph, tid, cm) returning id into r;
  exception when unique_violation then
    -- одновременная подача того же ребёнка другим пользователем
    raise exception 'already applied' using errcode = '23505';
  end;
  return r;
end $$;

-- ===== Решение администратора =====
-- approve = true: гостевой участник (место проверяется повторно под блокировкой сбора), approve = false: отказ.
-- Возвращает id участника (подтверждение) или null (отказ). Повторное решение отклоняется.
create or replace function camp_application_decide(aid uuid, approve boolean, note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a camp_applications; r uuid; nt text := nullif(btrim(note), ''); nm text; tp numeric;
begin
  perform camp_assert_admin();
  if approve is null then raise exception 'bad decision' using errcode = '22023'; end if;
  if length(coalesce(nt, '')) > 500 then raise exception 'bad note' using errcode = '22023'; end if;
  select * into a from camp_applications where id = aid for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.status <> 'new' then raise exception 'already decided' using errcode = '22023'; end if;
  if approve then
    -- Каждое подтверждение создаёт новую запись участника: чужая запись с тем же именем не переиспользуется.
    -- Если имя занято (тёзка или прежняя запись), к имени добавляется дата рождения; если и оно занято, подтверждение отклоняется.
    perform 1 from camps where id = a.camp_id for update;
    select price into tp from camp_tariffs where id = a.tariff_id and camp_id = a.camp_id and active;
    if tp is null then raise exception 'tariff not found' using errcode = 'P0002'; end if;
    nm := a.child_name;
    if exists (select 1 from camp_participants where camp_id = a.camp_id and player_id is null and lower(btrim(guest_name)) = lower(nm)) then
      nm := left(a.child_name, 80 - 13) || ' (' || to_char(a.child_birth, 'DD.MM.YYYY') || ')';
    end if;
    if exists (select 1 from camp_participants where camp_id = a.camp_id and player_id is null and lower(btrim(guest_name)) = lower(nm)) then
      raise exception 'already registered' using errcode = '23505';
    end if;
    perform camp_assert_seat(a.camp_id);
    perform set_config('camp.note', 'admin', true);
    insert into camp_participants (camp_id, player_id, guest_name, guest_contact, tariff_id, amount, comment, status, registered_on, owner_user_id)
    values (a.camp_id, null, nm, left(a.parent_name, 45) || ', ' || a.parent_phone, a.tariff_id, tp, a.comment, 'registered', current_date, a.owner_user_id) returning id into r;
    perform set_config('camp.note', '', true);
    update camp_applications set status = 'approved', decided_by = current_user_id(), decided_at = now(), decision_note = nt, participant_id = r where id = aid;
    return r;
  end if;
  update camp_applications set status = 'rejected', decided_by = current_user_id(), decided_at = now(), decision_note = nt where id = aid;
  return null;
end $$;

revoke execute on function camp_apply(uuid, text, date, text, text, uuid, text), camp_application_decide(uuid, boolean, text) from public, anon;
grant execute on function camp_apply(uuid, text, date, text, text, uuid, text), camp_application_decide(uuid, boolean, text) to authenticated;

-- Ручная запись гостя не поднимает запись, у которой есть владелец (заявка гостя): иначе новый человек получил бы чужую историю и платежи
create or replace function camp_register_guest(cid uuid, nm text, contact text, tid uuid, amt numeric, tshirt text, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tp numeric; r uuid; st text; ow uuid;
begin
  perform camp_assert_admin();
  perform 1 from camps where id = cid for update;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
  if nullif(btrim(nm), '') is null or length(btrim(nm)) > 80 or length(coalesce(contact, '')) > 80 then raise exception 'name required' using errcode = '22023'; end if;
  select price into tp from camp_tariffs where id = tid and camp_id = cid and active;
  if tp is null then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  if amt is not null and amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id, status, owner_user_id into r, st, ow from camp_participants where camp_id = cid and player_id is null and lower(btrim(guest_name)) = lower(btrim(nm));
  if r is not null and st = 'registered' then raise exception 'already registered' using errcode = '23505'; end if;
  if r is not null and ow is not null then raise exception 'guest has owner' using errcode = '23505'; end if;
  if r is not null and coalesce(amt, tp) < (select coalesce(sum(amount), 0) from camp_payments where participant_id = r) then raise exception 'amount below paid' using errcode = '22023'; end if;
  perform camp_assert_seat(cid);
  perform set_config('camp.note', 'admin', true);
  if r is null then
    insert into camp_participants (camp_id, player_id, guest_name, guest_contact, tariff_id, amount, tshirt_size, comment, status, registered_on)
    values (cid, null, btrim(nm), nullif(btrim(contact), ''), tid, coalesce(amt, tp), nullif(btrim(tshirt), ''), nullif(btrim(cmt), ''), 'registered', current_date) returning id into r;
  else
    update camp_participants set guest_contact = nullif(btrim(contact), ''), tariff_id = tid, amount = coalesce(amt, tp),
      tshirt_size = nullif(btrim(tshirt), ''), comment = nullif(btrim(cmt), ''), status = 'registered' where id = r;
  end if;
  perform set_config('camp.note', '', true);
  return r;
end $$;
revoke execute on function camp_register_guest(uuid, text, text, uuid, numeric, text, text) from public, anon;
grant execute on function camp_register_guest(uuid, text, text, uuid, numeric, text, text) to authenticated;
revoke execute on function camp_clean_text(text), camp_norm_name(text) from public, anon;
grant execute on function camp_clean_text(text), camp_norm_name(text) to authenticated;
