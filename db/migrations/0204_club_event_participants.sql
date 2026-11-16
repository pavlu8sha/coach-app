-- 0204 (Issue #677, этап 2 раздела «Мероприятия», условия: docs/CLUB_EVENTS_ACCEPTANCE.md v6, разделы PT, LD, PR):
-- участники мероприятия (игроки клуба), лимит и дедлайн записи как серверные ограничения, индивидуальные цены с историей, массовое добавление группы.
-- Платежи (service_payments, kind='event') и касса: следующий этап; здесь платёжных объектов нет.
-- Правила: записывать можно только в активное мероприятие, до дедлайна (Asia/Tbilisi), при свободном месте, только игрока клуба со статусом «Занимается»;
--   одна запись на игрока (уникально, отменённая восстанавливается, а не создаётся заново); отмена записи возможна в любом статусе мероприятия;
--   восстановление: активное мероприятие, дедлайн, лимит, игрок активен. Лимит считает только активные записи; гонки закрыты блокировкой строки мероприятия.
-- Права: только администратор своего клуба (club_event_assert_admin); запись только функциями; удаления и очистки нет.
-- Откат: db/ops/rollback-0204-club-event-participants.sql (только пока в таблицах участников нет данных).

create table if not exists club_event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references club_events(id) on delete restrict,
  player_id uuid not null references players(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  individual_price numeric(10,2) check (individual_price is null or individual_price >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  unique (event_id, player_id)
);
create index if not exists club_event_participants_event_idx on club_event_participants (event_id, status);

-- История статусов записи: только добавление (PT10)
create table if not exists club_event_participant_log (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references club_event_participants(id) on delete restrict,
  event_id uuid not null references club_events(id) on delete restrict,
  actor_id uuid references users(id),
  from_status text check (from_status is null or from_status in ('active', 'cancelled')),
  to_status text not null check (to_status in ('active', 'cancelled')),
  at timestamptz not null default clock_timestamp()
);
create index if not exists club_event_participant_log_idx on club_event_participant_log (participant_id, at);

-- история цен: индивидуальная цена привязывается к записи
alter table club_event_price_log drop constraint if exists club_event_price_log_participant_fk;
alter table club_event_price_log add constraint club_event_price_log_participant_fk
  foreign key (participant_id) references club_event_participants(id) on delete restrict;

alter table club_event_participants enable row level security;
alter table club_event_participant_log enable row level security;
drop policy if exists club_event_participants_admin_read on club_event_participants;
create policy club_event_participants_admin_read on club_event_participants for select
  using (is_admin() and exists (select 1 from club_events e where e.id = event_id and e.club_id = club_event_current_club()));
drop policy if exists club_event_participant_log_admin_read on club_event_participant_log;
create policy club_event_participant_log_admin_read on club_event_participant_log for select
  using (is_admin() and exists (select 1 from club_events e where e.id = event_id and e.club_id = club_event_current_club()));
revoke all on club_event_participants, club_event_participant_log from public, anon, authenticated, service_role;
grant select on club_event_participants, club_event_participant_log to authenticated, service_role;

-- Защита: записи не удаляются, таблицы не очищаются, журнал статусов не правится (владелец может отключить триггер осознанно)
drop trigger if exists club_event_participants_no_delete on club_event_participants;
create trigger club_event_participants_no_delete before delete on club_event_participants for each row execute function club_event_guard();
drop trigger if exists club_event_participants_no_truncate on club_event_participants;
create trigger club_event_participants_no_truncate before truncate on club_event_participants for each statement execute function club_event_guard();
drop trigger if exists club_event_participant_log_immutable on club_event_participant_log;
create trigger club_event_participant_log_immutable before update or delete on club_event_participant_log for each row execute function club_event_guard();
drop trigger if exists club_event_participant_log_no_truncate on club_event_participant_log;
create trigger club_event_participant_log_no_truncate before truncate on club_event_participant_log for each statement execute function club_event_guard();

-- Служебная проверка записи: мероприятие активно, дедлайн не наступил (Asia/Tbilisi)
create or replace function club_event_seat_guard(ev club_events) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if ev.status <> 'active' then raise exception 'event not active' using errcode = '55000'; end if;
  if ev.signup_deadline is not null and (now() at time zone 'Asia/Tbilisi') >= ev.signup_deadline then
    raise exception 'deadline passed' using errcode = '55000';
  end if;
end $$;
revoke execute on function club_event_seat_guard(club_events) from public, anon, authenticated;

-- Добавить игрока. Предупреждение «не из групп мероприятия» не блокирует: без p_confirm возвращает applied=false, с p_confirm добавляет.
create or replace function club_event_participant_add(p_event uuid, p_player uuid, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid; ev club_events; pl players; n int; warns jsonb := '[]'::jsonb; pid uuid;
begin
  c := club_event_assert_admin();
  select * into ev from club_events where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  perform club_event_seat_guard(ev);
  select * into pl from players where id = p_player;
  if not found then raise exception 'player not found' using errcode = 'P0002'; end if;
  if pl.club_id is distinct from c then raise exception 'player of another club' using errcode = '22023'; end if;
  if pl.status <> 'active' then raise exception 'player not active' using errcode = '22023'; end if;
  if exists (select 1 from club_event_participants where event_id = p_event and player_id = p_player) then
    raise exception 'already participating' using errcode = '23505';
  end if;
  select count(*) into n from club_event_participants where event_id = p_event and status = 'active';
  if ev.capacity is not null and n >= ev.capacity then raise exception 'event full' using errcode = '55000'; end if;
  if exists (select 1 from club_event_groups where event_id = p_event)
     and (pl.group_id is null or not exists (select 1 from club_event_groups where event_id = p_event and group_id = pl.group_id)) then
    warns := warns || jsonb_build_array(jsonb_build_object('code', 'not_in_group'));
    if not coalesce(p_confirm, false) then return jsonb_build_object('applied', false, 'warnings', warns); end if;
  end if;
  insert into club_event_participants (event_id, player_id, created_by, updated_by) values (p_event, p_player, current_user_id(), current_user_id())
    returning id into pid;
  insert into club_event_participant_log (participant_id, event_id, actor_id, from_status, to_status) values (pid, p_event, current_user_id(), null, 'active');
  return jsonb_build_object('applied', true, 'participant_id', pid, 'warnings', warns);
end $$;

-- Группа перед добавлением: кого добавят, кого пропустят (уже участвует, статус не «Занимается»), хватит ли мест. Ничего не меняет.
create or replace function club_event_group_preview(p_event uuid, p_group uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid; ev club_events; gc uuid; n int; add_n int;
begin
  c := club_event_assert_admin();
  select * into ev from club_events where id = p_event;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into gc from groups where id = p_group;
  if not found then raise exception 'group not found' using errcode = 'P0002'; end if;
  if gc <> c then raise exception 'group of another club' using errcode = '22023'; end if;
  select count(*) into n from club_event_participants where event_id = p_event and status = 'active';
  select count(*) into add_n from players pl where pl.group_id = p_group and pl.club_id = c and pl.status = 'active'
     and not exists (select 1 from club_event_participants x where x.event_id = p_event and x.player_id = pl.id);
  return jsonb_build_object('add_count', add_n, 'active', n, 'capacity', ev.capacity,
    'over_limit', ev.capacity is not null and n + add_n > ev.capacity,
    'to_add', coalesce((select jsonb_agg(jsonb_build_object('player_id', pl.id, 'full_name', pl.full_name) order by pl.full_name, pl.id)
        from players pl where pl.group_id = p_group and pl.club_id = c and pl.status = 'active'
         and not exists (select 1 from club_event_participants x where x.event_id = p_event and x.player_id = pl.id)), '[]'::jsonb),
    'skipped', coalesce((select jsonb_agg(jsonb_build_object('player_id', pl.id, 'full_name', pl.full_name,
          'reason', case when exists (select 1 from club_event_participants x where x.event_id = p_event and x.player_id = pl.id) then 'already' else 'not_active' end)
          order by pl.full_name, pl.id)
        from players pl where pl.group_id = p_group and pl.club_id = c
         and (pl.status <> 'active' or exists (select 1 from club_event_participants x where x.event_id = p_event and x.player_id = pl.id))), '[]'::jsonb));
end $$;

-- Добавить группу одной операцией: активные игроки группы, которых ещё нет; всё или ничего (лимит не превышается, частичного добавления нет)
create or replace function club_event_group_add(p_event uuid, p_group uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid; ev club_events; gc uuid; n int; add_n int;
begin
  c := club_event_assert_admin();
  select * into ev from club_events where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  perform club_event_seat_guard(ev);
  select club_id into gc from groups where id = p_group;
  if not found then raise exception 'group not found' using errcode = 'P0002'; end if;
  if gc <> c then raise exception 'group of another club' using errcode = '22023'; end if;
  select count(*) into n from club_event_participants where event_id = p_event and status = 'active';
  select count(*) into add_n from players pl where pl.group_id = p_group and pl.club_id = c and pl.status = 'active'
     and not exists (select 1 from club_event_participants x where x.event_id = p_event and x.player_id = pl.id);
  if ev.capacity is not null and n + add_n > ev.capacity then raise exception 'event full' using errcode = '55000'; end if;
  with ins as (
    insert into club_event_participants (event_id, player_id, created_by, updated_by)
      select p_event, pl.id, current_user_id(), current_user_id() from players pl
       where pl.group_id = p_group and pl.club_id = c and pl.status = 'active'
         and not exists (select 1 from club_event_participants x where x.event_id = p_event and x.player_id = pl.id)
      returning id)
  insert into club_event_participant_log (participant_id, event_id, actor_id, from_status, to_status)
    select id, p_event, current_user_id(), null, 'active' from ins;
  return jsonb_build_object('applied', true, 'added', add_n);
end $$;

-- Отмена записи: в любом статусе мероприятия; строка, цена и история остаются. Повтор для уже отменённой: applied=false, без записи в журнал.
create or replace function club_event_participant_cancel(p_participant uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid; ev club_events; pt club_event_participants; eid uuid;
begin
  c := club_event_assert_admin();
  select event_id into eid from club_event_participants where id = p_participant;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  select * into ev from club_events where id = eid for update;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into pt from club_event_participants where id = p_participant for update;
  if pt.status = 'cancelled' then return jsonb_build_object('applied', false); end if;
  update club_event_participants set status = 'cancelled', updated_at = now(), updated_by = current_user_id() where id = p_participant;
  insert into club_event_participant_log (participant_id, event_id, actor_id, from_status, to_status) values (p_participant, eid, current_user_id(), 'active', 'cancelled');
  return jsonb_build_object('applied', true);
end $$;

-- Восстановление той же записи (не новой): активное мероприятие, дедлайн, свободное место, игрок «Занимается». Цена и история сохраняются.
create or replace function club_event_participant_restore(p_participant uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid; ev club_events; pt club_event_participants; pl players; eid uuid; n int;
begin
  c := club_event_assert_admin();
  select event_id into eid from club_event_participants where id = p_participant;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  select * into ev from club_events where id = eid for update;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into pt from club_event_participants where id = p_participant for update;
  if pt.status = 'active' then return jsonb_build_object('applied', false); end if;
  perform club_event_seat_guard(ev);
  select * into pl from players where id = pt.player_id;
  if pl.status <> 'active' then raise exception 'player not active' using errcode = '22023'; end if;
  select count(*) into n from club_event_participants where event_id = eid and status = 'active';
  if ev.capacity is not null and n >= ev.capacity then raise exception 'event full' using errcode = '55000'; end if;
  update club_event_participants set status = 'active', updated_at = now(), updated_by = current_user_id() where id = p_participant;
  insert into club_event_participant_log (participant_id, event_id, actor_id, from_status, to_status) values (p_participant, eid, current_user_id(), 'cancelled', 'active');
  return jsonb_build_object('applied', true);
end $$;

-- Индивидуальная цена записи (PR3, PR5): p_price = null сбрасывает на цену мероприятия. Причина обязательна (не короче 3 символов) при любом изменении;
-- то же значение ничего не пишет. Доступно в любом статусе мероприятия и записи. История пишет эффективную цену до и после.
-- Нижняя граница «не ниже засчитанного» (PR11, PR12) включается вместе с платежами: до них засчитанное всегда 0.
create or replace function club_event_participant_set_price(p_participant uuid, p_price numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid; ev club_events; pt club_event_participants; eid uuid; old_eff numeric; new_eff numeric;
begin
  c := club_event_assert_admin();
  select event_id into eid from club_event_participants where id = p_participant;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  select * into ev from club_events where id = eid for update;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into pt from club_event_participants where id = p_participant for update;
  if p_price is not null and (p_price < 0 or p_price <> round(p_price, 2) or p_price >= 100000000) then raise exception 'bad price' using errcode = '22023'; end if;
  if pt.individual_price is not distinct from p_price then return jsonb_build_object('applied', false); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'price change needs reason' using errcode = '22023'; end if;
  old_eff := coalesce(pt.individual_price, ev.base_price);
  new_eff := coalesce(p_price, ev.base_price);
  update club_event_participants set individual_price = p_price, updated_at = now(), updated_by = current_user_id() where id = p_participant;
  insert into club_event_price_log (event_id, participant_id, scope, old_amount, new_amount, reason, actor_id)
    values (eid, p_participant, 'individual', old_eff, new_eff, btrim(p_reason), current_user_id());
  return jsonb_build_object('applied', true, 'price', new_eff);
end $$;

-- Список участников (по имени, без рейтингов и сравнений); p_status: active или cancelled
create or replace function club_event_participants_list(p_event uuid, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid; ev club_events;
begin
  c := club_event_assert_admin();
  if p_status is not null and p_status not in ('active', 'cancelled') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into ev from club_events where id = p_event;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', pt.id, 'player_id', pl.id, 'full_name', pl.full_name, 'group_id', pl.group_id, 'group_name', g.name,
             'player_status', pl.status, 'status', pt.status, 'base_price', ev.base_price, 'individual_price', pt.individual_price,
             'price', coalesce(pt.individual_price, ev.base_price),
             'not_in_group', exists (select 1 from club_event_groups eg where eg.event_id = ev.id)
                             and (pl.group_id is null or not exists (select 1 from club_event_groups eg where eg.event_id = ev.id and eg.group_id = pl.group_id)))
           order by pl.full_name, pt.id)
      from club_event_participants pt join players pl on pl.id = pt.player_id left join groups g on g.id = pl.group_id
     where pt.event_id = p_event and (p_status is null or pt.status = p_status)), '[]'::jsonb);
end $$;

-- История одной записи: смены статуса и цены
create or replace function club_event_participant_history(p_participant uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid; eid uuid; ec uuid;
begin
  c := club_event_assert_admin();
  select pt.event_id, e.club_id into eid, ec from club_event_participants pt join club_events e on e.id = pt.event_id where pt.id = p_participant;
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
  if ec <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'status_log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'actor_id', l.actor_id, 'from', l.from_status, 'to', l.to_status) order by l.at, l.id)
                              from club_event_participant_log l where l.participant_id = p_participant), '[]'::jsonb),
    'price_log', coalesce((select jsonb_agg(jsonb_build_object('at', x.at, 'actor_id', x.actor_id, 'old_amount', x.old_amount, 'new_amount', x.new_amount, 'reason', x.reason)
                                              order by x.at, x.id) from club_event_price_log x where x.participant_id = p_participant), '[]'::jsonb));
end $$;

-- Правка мероприятия: контракт предупреждений EV10/LD4 (из 0202; сигнатура и права не меняются)
create or replace function club_event_update(p_id uuid, p_patch jsonb, p_reason text default null, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ev club_events; c uuid; k text; v jsonb; before_s jsonb; after_s jsonb; np numeric; gs uuid[]; cur uuid[];
        n_name text; n_desc text; n_date date; n_time time; n_place text; n_price numeric; n_dead timestamp; n_cap int;
        n_active int; warns jsonb := '[]'::jsonb;
begin
  c := club_event_assert_admin();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'bad patch' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('name', 'description', 'starts_on', 'starts_time', 'place', 'base_price', 'signup_deadline', 'capacity', 'group_ids') then
      raise exception 'bad field %', k using errcode = '22023';
    end if;
  end loop;
  select * into ev from club_events where id = p_id for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  before_s := club_event_snapshot(p_id);
  n_name := ev.name; n_desc := ev.description; n_date := ev.starts_on; n_time := ev.starts_time; n_place := ev.place;
  n_price := ev.base_price; n_dead := ev.signup_deadline; n_cap := ev.capacity;
  begin
    if p_patch ? 'name' then
      v := p_patch -> 'name';
      if jsonb_typeof(v) <> 'string' or length(btrim(v #>> '{}')) not between 1 and 200 then raise exception 'bad name' using errcode = '22023'; end if;
      n_name := btrim(v #>> '{}');
    end if;
    if p_patch ? 'description' then
      v := p_patch -> 'description';
      if jsonb_typeof(v) = 'null' then n_desc := null;
      elsif jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 2000 then n_desc := nullif(btrim(v #>> '{}'), '');
      else raise exception 'bad description' using errcode = '22023'; end if;
    end if;
    if p_patch ? 'place' then
      v := p_patch -> 'place';
      if jsonb_typeof(v) = 'null' then n_place := null;
      elsif jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 200 then n_place := nullif(btrim(v #>> '{}'), '');
      else raise exception 'bad place' using errcode = '22023'; end if;
    end if;
    if p_patch ? 'starts_on' then
      v := p_patch -> 'starts_on';
      if jsonb_typeof(v) <> 'string' then raise exception 'bad starts_on' using errcode = '22023'; end if;
      n_date := (v #>> '{}')::date;
    end if;
    if p_patch ? 'starts_time' then
      v := p_patch -> 'starts_time';
      if jsonb_typeof(v) = 'null' then n_time := null;
      elsif jsonb_typeof(v) = 'string' then n_time := (v #>> '{}')::time;
      else raise exception 'bad starts_time' using errcode = '22023'; end if;
    end if;
    if p_patch ? 'signup_deadline' then
      v := p_patch -> 'signup_deadline';
      if jsonb_typeof(v) = 'null' then n_dead := null;
      elsif jsonb_typeof(v) = 'string' then n_dead := (v #>> '{}')::timestamp;
      else raise exception 'bad deadline' using errcode = '22023'; end if;
    end if;
    if p_patch ? 'capacity' then
      v := p_patch -> 'capacity';
      if jsonb_typeof(v) = 'null' then n_cap := null;
      elsif jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric) and (v #>> '{}')::numeric >= 1 then n_cap := (v #>> '{}')::int;
      else raise exception 'bad capacity' using errcode = '22023'; end if;
    end if;
    if p_patch ? 'base_price' then
      v := p_patch -> 'base_price';
      if jsonb_typeof(v) <> 'number' then raise exception 'bad price' using errcode = '22023'; end if;
      np := (v #>> '{}')::numeric;
      if np < 0 or np <> round(np, 2) or np >= 100000000 then raise exception 'bad price' using errcode = '22023'; end if;
      n_price := np;
    end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'bad value' using errcode = '22023';
  end;
  -- EV10 / LD4 (U13): при записанных участниках смена даты или времени и снижение лимита ниже числа записанных требуют подтверждения.
  -- Без подтверждения функция возвращает предупреждения и ничего не меняет; с подтверждением применяет, записи не отменяются.
  select count(*) into n_active from club_event_participants where event_id = p_id and status = 'active';
  if n_active > 0 then
    if n_date is distinct from ev.starts_on or n_time is distinct from ev.starts_time then
      warns := warns || jsonb_build_array(jsonb_build_object('code', 'date_change', 'affected', n_active));
    end if;
    if n_cap is not null and n_cap < n_active and n_cap is distinct from ev.capacity then
      warns := warns || jsonb_build_array(jsonb_build_object('code', 'capacity_below_active', 'active', n_active, 'capacity', n_cap, 'over', n_active - n_cap));
    end if;
    if jsonb_array_length(warns) > 0 and not coalesce(p_confirm, false) then
      return jsonb_build_object('applied', false, 'warnings', warns);
    end if;
  end if;
  if n_price <> ev.base_price then
    if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'price change needs reason' using errcode = '22023'; end if;
    insert into club_event_price_log (event_id, scope, old_amount, new_amount, reason, actor_id)
      values (p_id, 'base', ev.base_price, n_price, btrim(p_reason), current_user_id());
  end if;
  if p_patch ? 'group_ids' then
    v := p_patch -> 'group_ids';
    if jsonb_typeof(v) = 'null' then gs := '{}';
    elsif jsonb_typeof(v) = 'array' then
      begin
        gs := club_event_groups_check(ev.club_id, array(select jsonb_array_elements_text(v)::uuid));
      exception when invalid_text_representation then raise exception 'bad group id' using errcode = '22023';
      end;
    else raise exception 'bad group_ids' using errcode = '22023'; end if;
    select coalesce(array_agg(group_id order by group_id), '{}') into cur from club_event_groups where event_id = p_id;
    if cur is distinct from gs then
      delete from club_event_groups where event_id = p_id;
      insert into club_event_groups (event_id, group_id) select p_id, g from unnest(gs) g;
    end if;
  end if;
  update club_events set name = n_name, description = n_desc, starts_on = n_date, starts_time = n_time, place = n_place, base_price = n_price,
         signup_deadline = n_dead, capacity = n_cap, updated_at = now(), updated_by = current_user_id() where id = p_id
     and (name, description, starts_on, starts_time, place, base_price, signup_deadline, capacity)
         is distinct from (n_name, n_desc, n_date, n_time, n_place, n_price, n_dead, n_cap);
  after_s := club_event_snapshot(p_id);
  if after_s is distinct from before_s then perform club_event_log_add(p_id, 'updated', before_s, after_s); end if;
  return jsonb_build_object('applied', true, 'warnings', warns);
end $$;

-- Список и карточка: число активных участников, свободные места, превышение лимита (U14)
create or replace function club_event_list(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid;
begin
  c := club_event_assert_admin();
  if p_status is not null and p_status not in ('draft', 'active', 'finished', 'cancelled') then raise exception 'bad status' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'name', e.name, 'starts_on', e.starts_on, 'starts_time', e.starts_time, 'place', e.place, 'base_price', e.base_price,
             'signup_deadline', e.signup_deadline, 'capacity', e.capacity, 'status', e.status,
             'active_count', (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'),
             'free_places', case when e.capacity is null then null else greatest(e.capacity - (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'), 0) end,
             'over_limit', coalesce(e.capacity < (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'), false),
             'club_wide', not exists (select 1 from club_event_groups g where g.event_id = e.id),
             'group_ids', coalesce((select jsonb_agg(g.group_id order by g.group_id) from club_event_groups g where g.event_id = e.id), '[]'::jsonb),
             'group_names', coalesce((select jsonb_agg(gr.name order by gr.name) from club_event_groups g join groups gr on gr.id = g.group_id where g.event_id = e.id), '[]'::jsonb))
           order by (e.status in ('finished', 'cancelled')),
                    case when e.status in ('draft', 'active') then e.starts_on end asc,
                    e.starts_on desc, e.starts_time asc nulls first, e.id)
      from club_events e where e.club_id = c and (p_status is null or e.status = p_status)), '[]'::jsonb);
end $$;

create or replace function club_event_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e club_events; c uuid;
begin
  c := club_event_assert_admin();
  select * into e from club_events where id = p_id;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if e.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', e.id, 'club_id', e.club_id, 'name', e.name, 'description', e.description, 'starts_on', e.starts_on, 'starts_time', e.starts_time, 'place', e.place,
    'base_price', e.base_price, 'signup_deadline', e.signup_deadline, 'capacity', e.capacity, 'status', e.status,
    'created_at', e.created_at, 'updated_at', e.updated_at,
    'active_count', (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'),
             'free_places', case when e.capacity is null then null else greatest(e.capacity - (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'), 0) end,
             'over_limit', coalesce(e.capacity < (select count(*) from club_event_participants x where x.event_id = e.id and x.status = 'active'), false),
             'club_wide', not exists (select 1 from club_event_groups g where g.event_id = e.id),
    'group_ids', coalesce((select jsonb_agg(g.group_id order by g.group_id) from club_event_groups g where g.event_id = e.id), '[]'::jsonb),
    'group_names', coalesce((select jsonb_agg(gr.name order by gr.name) from club_event_groups g join groups gr on gr.id = g.group_id where g.event_id = e.id), '[]'::jsonb));
end $$;

revoke execute on function club_event_participant_add(uuid, uuid, boolean), club_event_group_preview(uuid, uuid), club_event_group_add(uuid, uuid),
  club_event_participant_cancel(uuid), club_event_participant_restore(uuid), club_event_participant_set_price(uuid, numeric, text),
  club_event_participants_list(uuid, text), club_event_participant_history(uuid) from public, anon;
grant execute on function club_event_participant_add(uuid, uuid, boolean), club_event_group_preview(uuid, uuid), club_event_group_add(uuid, uuid),
  club_event_participant_cancel(uuid), club_event_participant_restore(uuid), club_event_participant_set_price(uuid, numeric, text),
  club_event_participants_list(uuid, text), club_event_participant_history(uuid) to authenticated;
