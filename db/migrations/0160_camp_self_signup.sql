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
alter table camps add constraint camps_slug_check check (slug is null or (length(slug) between 3 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));
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
revoke all on camp_participant_events from service_role;
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
revoke all on camp_cancel_terms from service_role;
grant select on camp_cancel_terms to service_role;
-- Читает администратор, локальный администратор сбора и родитель активного ребёнка клуба этого сбора (только активный сбор);
-- посетителям публичной страницы условия отдаёт camp_public. Политика создаётся ниже, после camp_visible_to_parent.

-- ===== Служебные функции =====
-- Журнал статусов и лимит мест ведутся триггерами на самой таблице: прямая запись в таблицу (администратор, служебная роль)
-- не обходит ни журнал, ни лимит. Причина записи (parent/admin) передаётся настройкой camp.note, по умолчанию 'direct'.
create or replace function camp_participants_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.status = new.status and old.camp_id = new.camp_id then return null; end if;
  insert into camp_participant_events (participant_id, camp_id, player_id, from_status, to_status, actor_id, tariff_id, amount, paid, terms_version, note)
  values (new.id, new.camp_id, new.player_id, case when tg_op = 'UPDATE' then old.status end, new.status, current_user_id(), new.tariff_id, new.amount,
          (select coalesce(sum(amount), 0) from camp_payments where participant_id = new.id),
          (select max(version) from camp_cancel_terms where camp_id = new.camp_id),
          coalesce(nullif(current_setting('camp.note', true), ''), 'direct'));
  return null;
end $$;
create trigger camp_participants_log after insert or update of status, camp_id on camp_participants
  for each row execute function camp_participants_log();

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

-- Лимит и для прямой записи в таблицу: любая вставка или переход в «registered» берёт блокировку сбора и проверяет место.
create or replace function camp_participants_seat_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'registered' and (tg_op = 'INSERT' or old.status <> 'registered' or old.camp_id <> new.camp_id) then
    perform 1 from camps where id = new.camp_id for update;
    perform camp_assert_seat(new.camp_id);
  end if;
  return new;
end $$;
create trigger camp_participants_seat_guard before insert or update of status, camp_id on camp_participants
  for each row execute function camp_participants_seat_guard();

revoke execute on function camp_participants_log(), camp_participants_seat_guard(), camp_assert_seat(uuid), camp_events_immutable() from public, anon, authenticated;

-- Родитель активного ребёнка клуба сбора, согласие не отозвано, сбор активен. Для политик и camp_seats.
create or replace function camp_visible_to_parent(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from camps c
      join players p on p.club_id = c.club_id and p.status = 'active'
      join player_guardians g on g.player_id = p.id
     where c.id = cid and c.active and g.user_id = current_user_id() and g.consent_revoked_at is null)
$$;
revoke execute on function camp_visible_to_parent(uuid) from public, anon;
grant execute on function camp_visible_to_parent(uuid) to authenticated;

create policy camp_cancel_terms_read on camp_cancel_terms for select
  using (is_admin() or is_location_admin(camp_location(camp_id)) or camp_visible_to_parent(camp_id));

-- ===== Администратор: лимит, ссылка, условия отмены =====
create or replace function camp_set_public(cid uuid, sl text, cap int) returns void
language plpgsql security definer set search_path = public as $$
declare s text := nullif(lower(btrim(sl)), '');
begin
  perform camp_assert_admin();
  if s is not null and (length(s) not between 3 and 60 or s !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then raise exception 'bad slug' using errcode = '22023'; end if;
  if cap is not null and cap < 1 then raise exception 'bad capacity' using errcode = '22023'; end if;
  perform 1 from camps where id = cid for update;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
  -- Лимит не ниже числа подтверждённых участников (registered). Отменённые, отказанные и гостевые заявки не считаются.
  if cap is not null and cap < (select count(*) from camp_participants where camp_id = cid and status = 'registered') then
    raise exception 'capacity below registered' using errcode = '22023';
  end if;
  -- sl = null: ссылку не менять; sl = '' (пусто): убрать ссылку; лимит: null = без лимита
  update camps set slug = case when sl is null then slug else s end, capacity = cap where id = cid;
end $$;

-- Новая версия условий: массив периодов [{from, to, text}], даты необязательны (строка YYYY-MM-DD или null). Лишние ключи отбрасываются.
-- Прежние версии остаются.
create or replace function camp_terms_save(cid uuid, periods jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare p jsonb; f date; t date; v int; clean jsonb := '[]'::jsonb; fs text; ts text;
begin
  perform camp_assert_admin();
  perform 1 from camps where id = cid for update;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
  if periods is null or jsonb_typeof(periods) <> 'array' or jsonb_array_length(periods) not between 1 and 10 or octet_length(periods::text) > 16000 then
    raise exception 'bad terms' using errcode = '22023';
  end if;
  for p in select * from jsonb_array_elements(periods) loop
    if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'text') is distinct from 'string'
       or regexp_replace(p ->> 'text', '[[:space:]\u00a0\u200b\u2060\ufeff]', '', 'g') = '' or length(p ->> 'text') > 500
       or jsonb_typeof(coalesce(p -> 'from', 'null'::jsonb)) not in ('string', 'null')
       or jsonb_typeof(coalesce(p -> 'to', 'null'::jsonb)) not in ('string', 'null') then
      raise exception 'bad terms' using errcode = '22023';
    end if;
    fs := nullif(p ->> 'from', ''); ts := nullif(p ->> 'to', '');
    if (fs is not null and fs !~ '^\d{4}-\d{2}-\d{2}$') or (ts is not null and ts !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'bad terms' using errcode = '22023'; end if;
    begin
      f := fs::date; t := ts::date;
    exception when others then
      raise exception 'bad terms' using errcode = '22023';
    end;
    if f is not null and t is not null and t < f then raise exception 'bad terms' using errcode = '22023'; end if;
    clean := clean || jsonb_build_array(jsonb_build_object('from', fs, 'to', ts, 'text', btrim(p ->> 'text')));
  end loop;
  select coalesce(max(version), 0) + 1 into v from camp_cancel_terms where camp_id = cid;
  insert into camp_cancel_terms (camp_id, version, periods, created_by) values (cid, v, clean, current_user_id());
  return v;
end $$;

-- ===== Свободные места (null — лимита нет) =====
-- Администратору по любому сбору; родителю только по активному сбору своего клуба (camp_visible_to_parent); иначе forbidden
-- (и для чужого, и для неактивного, и для несуществующего сбора: ответ не различается). Публичная страница берёт признак из camp_public.
create or replace function camp_seats(cid uuid) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null or not (is_admin() or camp_visible_to_parent(cid)) then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select case when c.capacity is null then null
                      else greatest(c.capacity - (select count(*)::int from camp_participants where camp_id = c.id and status = 'registered'), 0) end
            from camps c where c.id = cid);
end $$;

-- ===== Публичные данные сбора без входа =====
create or replace function camp_public(sl text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c camps;
begin
  select * into c from camps where slug = lower(btrim(sl)) and active and ends_on >= (now() at time zone 'Asia/Tbilisi')::date;
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
  perform set_config('camp.note', 'parent', true);
  if r is null then
    insert into camp_participants (camp_id, player_id, tariff_id, amount, comment, status, registered_on)
    values (cid, p, tid, tp, cm, 'registered', (now() at time zone 'Asia/Tbilisi')::date) returning id into r;
  else
    update camp_participants set tariff_id = tid, amount = tp, comment = coalesce(cm, comment), status = 'registered' where id = r;
  end if;
  perform set_config('camp.note', '', true);
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
  if r is not null and coalesce(amt, tp) < (select coalesce(sum(amount), 0) from camp_payments where participant_id = r) then raise exception 'amount below paid' using errcode = '22023'; end if;
  perform camp_assert_seat(cid);
  perform set_config('camp.note', 'admin', true);
  if r is null then
    insert into camp_participants (camp_id, player_id, tariff_id, amount, tshirt_size, comment, status, registered_on)
    values (cid, p, tid, coalesce(amt, tp), nullif(trim(tshirt), ''), nullif(trim(cmt), ''), 'registered', current_date) returning id into r;
  else
    update camp_participants set tariff_id = tid, amount = coalesce(amt, tp), tshirt_size = nullif(trim(tshirt), ''), comment = nullif(trim(cmt), ''), status = 'registered' where id = r;
  end if;
  perform set_config('camp.note', '', true);
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

create or replace function camp_update_participant(pid uuid, tid uuid, amt numeric, tshirt text, cmt text, st text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid; old text;
begin
  perform camp_assert_admin();
  select camp_id, status into cid, old from camp_participants where id = pid;
  if cid is null then raise exception 'participant not found' using errcode = 'P0002'; end if;
  perform 1 from camps where id = cid for update;
  select status into old from camp_participants where id = pid;
  -- «cancelled» (отмена родителем) админ не выставляет, но может править сумму и комментарий отменённой записи, оставляя статус
  if st is null or (st not in ('registered', 'declined') and not (st = 'cancelled' and old = 'cancelled')) then raise exception 'bad status' using errcode = '22023'; end if;
  if amt is null or amt < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if amt < (select coalesce(sum(amount), 0) from camp_payments where participant_id = pid) then raise exception 'amount below paid' using errcode = '22023'; end if;
  if tid is not null and not exists (select 1 from camp_tariffs where id = tid and camp_id = cid) then raise exception 'tariff not found' using errcode = 'P0002'; end if;
  if st = 'registered' and old <> 'registered' then perform camp_assert_seat(cid); end if;
  perform set_config('camp.note', 'admin', true);
  update camp_participants set tariff_id = coalesce(tid, tariff_id), amount = amt, tshirt_size = nullif(trim(tshirt), ''), comment = nullif(trim(cmt), ''), status = st where id = pid;
  perform set_config('camp.note', '', true);
end $$;

revoke execute on function camp_set_public(uuid, text, int), camp_terms_save(uuid, jsonb), camp_seats(uuid), camp_parent_register(uuid, uuid, uuid, text),
  camp_public(text) from public, anon;
revoke execute on function camp_register(uuid, uuid, uuid, numeric, text, text), camp_register_guest(uuid, text, text, uuid, numeric, text, text),
  camp_update_participant(uuid, uuid, numeric, text, text, text) from public, anon;
grant execute on function camp_set_public(uuid, text, int), camp_terms_save(uuid, jsonb), camp_seats(uuid), camp_parent_register(uuid, uuid, uuid, text),
  camp_register(uuid, uuid, uuid, numeric, text, text), camp_register_guest(uuid, text, text, uuid, numeric, text, text),
  camp_update_participant(uuid, uuid, numeric, text, text, text) to authenticated;
grant execute on function camp_public(text) to anon, authenticated;
