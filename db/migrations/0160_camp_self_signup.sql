-- 0160 (Issue #470, этап 1): самозапись на сборы. Условия приёмки: docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md.
--  * лимит мест (camps.capacity) и публичная ссылка (camps.slug); лимит проверяется на сервере атомарно во всех путях,
--    которые создают или возвращают запись в статус «registered» (блокировка строки сбора);
--  * статус участника «cancelled» (отмена родителем) помимо «declined» (отказ администратора);
--  * журнал статусов участника camp_participant_events и версии условий отмены camp_cancel_terms: только добавление;
--  * camp_parent_register: родитель записывает своего ребёнка (сразу подтверждённая запись, сумма по тарифу);
--  * camp_public(slug): публичные данные сбора без входа (без участников и персональных данных);
--  * camp_seats: сколько мест свободно. Существующие администраторские функции работают как раньше, плюс проверка лимита.
-- Старые данные не меняются: все участники остаются «registered».

alter table camps add column if not exists capacity int;
alter table camps add column if not exists slug text;
alter table camps drop constraint if exists camps_capacity_check;
alter table camps add constraint camps_capacity_check check (capacity is null or capacity >= 1);
alter table camps drop constraint if exists camps_slug_check;
alter table camps add constraint camps_slug_check check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{2,59}$');
create unique index if not exists camps_slug_unique on camps (slug) where slug is not null;

alter table camp_participants drop constraint if exists camp_participants_status_check;
alter table camp_participants add constraint camp_participants_status_check check (status in ('registered', 'declined', 'cancelled'));

-- ===== Журнал статусов участника (только добавление) =====
create table camp_participant_events (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references camp_participants(id),
  camp_id uuid not null references camps(id),
  player_id uuid references players(id),
  from_status text,
  to_status text not null,
  actor_id uuid,
  at timestamptz not null default now(),
  tariff_id uuid references camp_tariffs(id),
  amount numeric(10,2),
  paid numeric(10,2),
  terms_version int,
  note text
);
create index camp_participant_events_participant on camp_participant_events (participant_id, at);

create or replace function camp_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'immutable' using errcode = 'P0001';
end $$;
create trigger camp_participant_events_no_change before update or delete on camp_participant_events
  for each row execute function camp_events_immutable();
create trigger camp_participant_events_no_truncate before truncate on camp_participant_events
  for each statement execute function camp_events_immutable();

alter table camp_participant_events enable row level security;
revoke all on camp_participant_events from public, anon, authenticated;
grant select on camp_participant_events to authenticated;
grant select on camp_participant_events to service_role;
create policy camp_participant_events_read on camp_participant_events for select
  using (is_admin() or is_guardian_of(player_id));

-- ===== Версии условий отмены (только добавление) =====
create table camp_cancel_terms (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references camps(id),
  version int not null,
  periods jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (camp_id, version)
);
create trigger camp_cancel_terms_no_change before update or delete on camp_cancel_terms
  for each row execute function camp_events_immutable();
create trigger camp_cancel_terms_no_truncate before truncate on camp_cancel_terms
  for each statement execute function camp_events_immutable();

alter table camp_cancel_terms enable row level security;
revoke all on camp_cancel_terms from public, anon, authenticated;
grant select on camp_cancel_terms to authenticated;
grant select on camp_cancel_terms to service_role;
create policy camp_cancel_terms_read on camp_cancel_terms for select using (auth.uid() is not null);

-- ===== Служебные функции =====
-- Запись в журнал статусов. Вызывается из функций ниже, пользователям недоступна.
create or replace function camp_log_event(pid uuid, from_st text, to_st text, nt text) returns void
language plpgsql security definer set search_path = public as $$
declare cp camp_participants;
begin
  select * into cp from camp_participants where id = pid;
  if not found then return; end if;
  insert into camp_participant_events (participant_id, camp_id, player_id, from_status, to_status, actor_id, tariff_id, amount, paid, terms_version, note)
  values (pid, cp.camp_id, cp.player_id, from_st, to_st, current_user_id(), cp.tariff_id, cp.amount,
          (select coalesce(sum(amount), 0) from camp_payments where participant_id = pid),
          (select max(version) from camp_cancel_terms where camp_id = cp.camp_id), nt);
end $$;

-- Лимит мест. Строка сбора уже заблокирована вызывающей функцией (for update): проверки идут по одной.
create or replace function camp_assert_seat(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cap int;
begin
  select capacity into cap from camps where id = cid;
  if cap is not null and (select count(*) from camp_participants where camp_id = cid and status = 'registered') >= cap then
    raise exception 'camp full' using errcode = '22023';
  end if;
end $$;

revoke execute on function camp_log_event(uuid, text, text, text), camp_assert_seat(uuid), camp_events_immutable() from public, anon, authenticated;

-- ===== Администратор: лимит, ссылка, условия отмены =====
create or replace function camp_set_public(cid uuid, sl text, cap int) returns void
language plpgsql security definer set search_path = public as $$
declare s text := nullif(lower(btrim(sl)), '');
begin
  perform camp_assert_admin();
  if s is not null and s !~ '^[a-z0-9][a-z0-9-]{2,59}$' then raise exception 'bad slug' using errcode = '22023'; end if;
  if cap is not null and cap < 1 then raise exception 'bad capacity' using errcode = '22023'; end if;
  update camps set slug = s, capacity = cap where id = cid;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
end $$;

-- Новая версия условий: массив периодов [{from, to, text}], даты необязательны. Прежние версии остаются.
create or replace function camp_terms_save(cid uuid, periods jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare p jsonb; f date; t date; v int;
begin
  perform camp_assert_admin();
  perform 1 from camps where id = cid for update;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
  if periods is null or jsonb_typeof(periods) <> 'array' or jsonb_array_length(periods) > 10 then raise exception 'bad terms' using errcode = '22023'; end if;
  for p in select * from jsonb_array_elements(periods) loop
    if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'text') is distinct from 'string'
       or nullif(btrim(p ->> 'text'), '') is null or length(p ->> 'text') > 500 then
      raise exception 'bad terms' using errcode = '22023';
    end if;
    begin
      f := nullif(p ->> 'from', '')::date;
      t := nullif(p ->> 'to', '')::date;
    exception when others then
      raise exception 'bad terms' using errcode = '22023';
    end;
    if f is not null and t is not null and t < f then raise exception 'bad terms' using errcode = '22023'; end if;
  end loop;
  select coalesce(max(version), 0) + 1 into v from camp_cancel_terms where camp_id = cid;
  insert into camp_cancel_terms (camp_id, version, periods, created_by) values (cid, v, periods, current_user_id());
  return v;
end $$;

-- ===== Свободные места (null — лимита нет) =====
create or replace function camp_seats(cid uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when c.capacity is null then null
              else greatest(c.capacity - (select count(*)::int from camp_participants where camp_id = c.id and status = 'registered'), 0) end
    from camps c where c.id = cid
$$;

-- ===== Публичные данные сбора без входа =====
create or replace function camp_public(sl text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c camps;
begin
  select * into c from camps where slug = lower(btrim(sl)) and active;
  if not found then return null; end if;
  return jsonb_build_object(
    'camp', jsonb_build_object('name', c.name, 'location', c.location, 'starts_on', c.starts_on, 'ends_on', c.ends_on,
      'booking_fee', c.booking_fee, 'booking_deadline', c.booking_deadline, 'full_payment_deadline', c.full_payment_deadline),
    'tariffs', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'price', t.price) order by t.price, t.name)
                           from camp_tariffs t where t.camp_id = c.id and t.active), '[]'::jsonb),
    'terms', coalesce((select periods from camp_cancel_terms where camp_id = c.id order by version desc limit 1), '[]'::jsonb),
    'seats_available', c.capacity is null or (select count(*) from camp_participants where camp_id = c.id and status = 'registered') < c.capacity);
end $$;

-- ===== Родитель записывает своего ребёнка =====
create or replace function camp_parent_register(cid uuid, p uuid, tid uuid, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c camps; pc uuid; pst text; tp numeric; r uuid; st text; paid numeric; cm text := nullif(btrim(cmt), '');
begin
  if current_user_id() is null or not is_guardian_of(p) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from camps where id = cid for update;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
  if not c.active or c.ends_on < (now() at time zone 'Asia/Tbilisi')::date then raise exception 'camp closed' using errcode = '22023'; end if;
  select club_id, status into pc, pst from players where id = p;
  if pc is distinct from c.club_id or pst is distinct from 'active' then raise exception 'not eligible' using errcode = '22023'; end if;
  select price into tp from camp_tariffs where id = tid and camp_id = cid and active;
  if tp is null then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  if length(coalesce(cm, '')) > 500 then raise exception 'bad comment' using errcode = '22023'; end if;
  select id, status into r, st from camp_participants where camp_id = cid and player_id = p;
  if st = 'registered' then raise exception 'already registered' using errcode = '23505'; end if;
  if st = 'declined' then raise exception 'registration declined' using errcode = '22023'; end if;
  if r is not null then
    select coalesce(sum(amount), 0) into paid from camp_payments where participant_id = r;
    if tp < paid then raise exception 'amount below paid' using errcode = '22023'; end if;
  end if;
  perform camp_assert_seat(cid);
  if r is null then
    insert into camp_participants (camp_id, player_id, tariff_id, amount, comment, status, registered_on)
    values (cid, p, tid, tp, cm, 'registered', (now() at time zone 'Asia/Tbilisi')::date) returning id into r;
  else
    update camp_participants set tariff_id = tid, amount = tp, comment = cm, status = 'registered' where id = r;
  end if;
  perform camp_log_event(r, st, 'registered', 'parent');
  return r;
end $$;

-- ===== Администраторские функции: прежняя логика плюс лимит и журнал =====
create or replace function camp_register(cid uuid, p uuid, tid uuid, amt numeric, tshirt text, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; pc uuid; tp numeric; r uuid; st text;
begin
  perform camp_assert_admin();
  select club_id into c from camps where id = cid for update;
  if c is null then raise exception 'camp not found' using errcode = 'P0002'; end if;
  select club_id into pc from players where id = p;
  if pc is null or pc <> c then raise exception 'player not in club' using errcode = '22023'; end if;
  select price into tp from camp_tariffs where id = tid and camp_id = cid and active;
  if tp is null then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  if amt is not null and amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id, status into r, st from camp_participants where camp_id = cid and player_id = p;
  if r is not null and st = 'registered' then raise exception 'already registered' using errcode = '23505'; end if;
  perform camp_assert_seat(cid);
  if r is null then
    insert into camp_participants (camp_id, player_id, tariff_id, amount, tshirt_size, comment, status, registered_on)
    values (cid, p, tid, coalesce(amt, tp), nullif(trim(tshirt), ''), nullif(trim(cmt), ''), 'registered', current_date) returning id into r;
  else
    update camp_participants set tariff_id = tid, amount = coalesce(amt, tp), tshirt_size = nullif(trim(tshirt), ''), comment = nullif(trim(cmt), ''), status = 'registered' where id = r;
  end if;
  perform camp_log_event(r, st, 'registered', 'admin');
  return r;
end $$;

create or replace function camp_register_guest(cid uuid, nm text, contact text, tid uuid, amt numeric, tshirt text, cmt text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tp numeric; r uuid; st text;
begin
  perform camp_assert_admin();
  perform 1 from camps where id = cid for update;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
  if nullif(btrim(nm), '') is null or length(btrim(nm)) > 80 or length(coalesce(contact, '')) > 80 then raise exception 'name required' using errcode = '22023'; end if;
  select price into tp from camp_tariffs where id = tid and camp_id = cid and active;
  if tp is null then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  if amt is not null and amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  select id, status into r, st from camp_participants where camp_id = cid and player_id is null and lower(btrim(guest_name)) = lower(btrim(nm));
  if r is not null and st = 'registered' then raise exception 'already registered' using errcode = '23505'; end if;
  perform camp_assert_seat(cid);
  if r is null then
    insert into camp_participants (camp_id, player_id, guest_name, guest_contact, tariff_id, amount, tshirt_size, comment, status, registered_on)
    values (cid, null, btrim(nm), nullif(btrim(contact), ''), tid, coalesce(amt, tp), nullif(btrim(tshirt), ''), nullif(btrim(cmt), ''), 'registered', current_date) returning id into r;
  else
    update camp_participants set guest_contact = nullif(btrim(contact), ''), tariff_id = tid, amount = coalesce(amt, tp),
      tshirt_size = nullif(btrim(tshirt), ''), comment = nullif(btrim(cmt), ''), status = 'registered' where id = r;
  end if;
  perform camp_log_event(r, st, 'registered', 'admin');
  return r;
end $$;

create or replace function camp_update_participant(pid uuid, tid uuid, amt numeric, tshirt text, cmt text, st text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid; old text;
begin
  perform camp_assert_admin();
  select camp_id, status into cid, old from camp_participants where id = pid;
  if cid is null then raise exception 'participant not found' using errcode = 'P0002'; end if;
  perform 1 from camps where id = cid for update;
  select status into old from camp_participants where id = pid;
  if st not in ('registered', 'declined') then raise exception 'bad status' using errcode = '22023'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if amt < (select coalesce(sum(amount), 0) from camp_payments where participant_id = pid) then raise exception 'amount below paid' using errcode = '22023'; end if;
  if tid is not null and not exists (select 1 from camp_tariffs where id = tid and camp_id = cid) then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  if st = 'registered' and old <> 'registered' then perform camp_assert_seat(cid); end if;
  update camp_participants set tariff_id = coalesce(tid, tariff_id), amount = amt, tshirt_size = nullif(trim(tshirt), ''), comment = nullif(trim(cmt), ''), status = st where id = pid;
  if st is distinct from old then perform camp_log_event(pid, old, st, 'admin'); end if;
end $$;

revoke execute on function camp_set_public(uuid, text, int), camp_terms_save(uuid, jsonb), camp_seats(uuid), camp_parent_register(uuid, uuid, uuid, text),
  camp_public(text) from public, anon;
revoke execute on function camp_register(uuid, uuid, uuid, numeric, text, text), camp_register_guest(uuid, text, text, uuid, numeric, text, text),
  camp_update_participant(uuid, uuid, numeric, text, text, text) from public, anon;
grant execute on function camp_set_public(uuid, text, int), camp_terms_save(uuid, jsonb), camp_seats(uuid), camp_parent_register(uuid, uuid, uuid, text),
  camp_register(uuid, uuid, uuid, numeric, text, text), camp_register_guest(uuid, text, text, uuid, numeric, text, text),
  camp_update_participant(uuid, uuid, numeric, text, text, text) to authenticated;
grant execute on function camp_public(text) to anon, authenticated;
