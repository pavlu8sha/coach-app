-- 0202 (Issue #677, этап 1 раздела «Мероприятия», условия: docs/CLUB_EVENTS_ACCEPTANCE.md v6):
-- разовые клубные мероприятия (теория, пикник, выезд, праздник). Отдельная сущность club_events: НЕ события-турниры (tournaments, event_*).
-- В этой миграции: мероприятие, привязка к группам, журнал изменений, история цен (база), функции создания, правки, смены статуса, чтения.
-- Участники, лимит и дедлайн как ограничения записи, индивидуальные цены, платежи (service_payments, kind='event') и касса: следующие миграции.
-- Права: только администратор (is_admin()) своего клуба; тренеры, локальные админы, родители и anon не создают и не читают; таблицы закрыты
--   для прямой записи всем прикладным ролям, пишут только функции (security definer). Физического удаления мероприятия нет.
-- Время: дата обязательна (starts_on), время необязательно (starts_time, NULL = не указано). Дедлайн записи: местное время Asia/Tbilisi (timestamp без пояса).
-- Клуб (P16, RLS и запрет по умолчанию): club_event_current_club() = users.club_id вошедшего; если он пуст и клуб в системе один, то он; иначе NULL.
--   NULL = отказ во всём разделе. RLS таблиц и каждая функция проверяют клуб; клуб от клиента не принимается.
-- Откат: db/ops/rollback-0202-club-events.sql (только пока в таблицах нет данных).

create table if not exists club_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  name text not null check (length(btrim(name)) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  starts_on date not null,
  starts_time time,
  place text check (place is null or length(place) <= 200),
  base_price numeric(10,2) not null check (base_price >= 0),
  signup_deadline timestamp,
  capacity int check (capacity is null or capacity >= 1),
  status text not null default 'draft' check (status in ('draft', 'active', 'finished', 'cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);
create index if not exists club_events_status_idx on club_events (club_id, status, starts_on desc);

create table if not exists club_event_groups (
  event_id uuid not null references club_events(id) on delete restrict,
  group_id uuid not null references groups(id) on delete restrict,
  primary key (event_id, group_id)
);

-- Журнал изменений мероприятия: только добавление
create table if not exists club_event_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references club_events(id) on delete restrict,
  actor_id uuid references users(id),
  action text not null check (action in ('created', 'updated', 'status')),
  before jsonb,
  after jsonb,
  at timestamptz not null default clock_timestamp()
);
create index if not exists club_event_log_event_idx on club_event_log (event_id, at);

-- История цен: базовая цена мероприятия (scope base) и, в следующей миграции, индивидуальная цена участника (scope individual). Только добавление.
create table if not exists club_event_price_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references club_events(id) on delete restrict,
  participant_id uuid,
  scope text not null check (scope in ('base', 'individual')),
  old_amount numeric(10,2),
  new_amount numeric(10,2) not null check (new_amount >= 0),
  reason text not null check (length(btrim(reason)) >= 3),
  actor_id uuid references users(id),
  at timestamptz not null default clock_timestamp()
);
create index if not exists club_event_price_log_event_idx on club_event_price_log (event_id, at);

-- Клуб вошедшего пользователя; NULL, если определить нельзя (тогда раздел закрыт). Читает только свою строку users: пользователь не может подделать club_id (политики update на users нет).
create or replace function club_event_current_club() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare c uuid; n int;
begin
  if current_user_id() is null then return null; end if;
  select club_id into c from users where id = current_user_id();
  if c is not null then return c; end if;
  select count(*) into n from clubs;
  if n = 1 then select id into c from clubs; return c; end if;
  return null;
end $$;
revoke execute on function club_event_current_club() from public, anon;
grant execute on function club_event_current_club() to authenticated;

-- Доступ: чтение только админу своего клуба через RLS, запись только функциями
alter table club_events enable row level security;
alter table club_event_groups enable row level security;
alter table club_event_log enable row level security;
alter table club_event_price_log enable row level security;
drop policy if exists club_events_admin_read on club_events;
create policy club_events_admin_read on club_events for select
  using (is_admin() and club_id is not distinct from club_event_current_club() and club_event_current_club() is not null);
drop policy if exists club_event_groups_admin_read on club_event_groups;
create policy club_event_groups_admin_read on club_event_groups for select
  using (is_admin() and exists (select 1 from club_events e where e.id = event_id and e.club_id = club_event_current_club()));
drop policy if exists club_event_log_admin_read on club_event_log;
create policy club_event_log_admin_read on club_event_log for select
  using (is_admin() and exists (select 1 from club_events e where e.id = event_id and e.club_id = club_event_current_club()));
drop policy if exists club_event_price_log_admin_read on club_event_price_log;
create policy club_event_price_log_admin_read on club_event_price_log for select
  using (is_admin() and exists (select 1 from club_events e where e.id = event_id and e.club_id = club_event_current_club()));
revoke all on club_events, club_event_groups, club_event_log, club_event_price_log from public, anon, authenticated, service_role;
grant select on club_events, club_event_groups, club_event_log, club_event_price_log to authenticated, service_role;

-- Защита истории: журналы не правятся и не удаляются, мероприятие не удаляется, таблицы не очищаются (владелец может отключить триггер осознанно)
create or replace function club_event_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'club event history is immutable' using errcode = 'P0001';
end $$;
revoke execute on function club_event_guard() from public, anon, authenticated;

drop trigger if exists club_events_no_delete on club_events;
create trigger club_events_no_delete before delete on club_events for each row execute function club_event_guard();
drop trigger if exists club_events_no_truncate on club_events;
create trigger club_events_no_truncate before truncate on club_events for each statement execute function club_event_guard();
drop trigger if exists club_event_groups_no_truncate on club_event_groups;
create trigger club_event_groups_no_truncate before truncate on club_event_groups for each statement execute function club_event_guard();
drop trigger if exists club_event_log_immutable on club_event_log;
create trigger club_event_log_immutable before update or delete on club_event_log for each row execute function club_event_guard();
drop trigger if exists club_event_log_no_truncate on club_event_log;
create trigger club_event_log_no_truncate before truncate on club_event_log for each statement execute function club_event_guard();
drop trigger if exists club_event_price_log_immutable on club_event_price_log;
create trigger club_event_price_log_immutable before update or delete on club_event_price_log for each row execute function club_event_guard();
drop trigger if exists club_event_price_log_no_truncate on club_event_price_log;
create trigger club_event_price_log_no_truncate before truncate on club_event_price_log for each statement execute function club_event_guard();

-- Служебные функции (недоступны вошедшим пользователям, кроме club_event_current_club)
-- Проверка админа и клуба; возвращает клуб вызывающего. Клуб не определён (два клуба без users.club_id): отказ по умолчанию.
create or replace function club_event_assert_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare c uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  c := club_event_current_club();
  if c is null then raise exception 'club not determined' using errcode = '42501'; end if;
  return c;
end $$;

-- Сторож масштабирования (D12): клубов больше одного, а у админа нет users.club_id. Такой админ в разделе «Мероприятия» закрыт (не открыт всем); preflight показывает результат.
create or replace function club_event_isolation_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from clubs) <= 1
      or not exists (select 1 from users where is_admin and club_id is null)
$$;

create or replace function club_event_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', e.name, 'description', e.description, 'starts_on', e.starts_on, 'starts_time', e.starts_time, 'place', e.place,
           'base_price', e.base_price, 'signup_deadline', e.signup_deadline, 'capacity', e.capacity, 'status', e.status,
           'group_ids', coalesce((select jsonb_agg(g.group_id order by g.group_id) from club_event_groups g where g.event_id = e.id), '[]'::jsonb))
    from club_events e where e.id = p_id
$$;

create or replace function club_event_log_add(p_id uuid, p_action text, p_before jsonb, p_after jsonb) returns void
language sql security definer set search_path = public as $$
  insert into club_event_log (event_id, actor_id, action, before, after) values (p_id, current_user_id(), p_action, p_before, p_after)
$$;

-- Проверка списка групп: каждая должна существовать и быть из клуба мероприятия
create or replace function club_event_groups_check(p_club uuid, p_groups uuid[]) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare g uuid; gc uuid; res uuid[] := '{}';
begin
  if p_groups is null then return res; end if;
  for g in select distinct x from unnest(p_groups) x where x is not null order by x loop
    select club_id into gc from groups where id = g;
    if not found then raise exception 'group not found' using errcode = 'P0002'; end if;
    if gc <> p_club then raise exception 'group of another club' using errcode = '22023'; end if;
    res := res || g;
  end loop;
  return res;
end $$;

revoke execute on function club_event_assert_admin(), club_event_isolation_ok(), club_event_snapshot(uuid),
  club_event_log_add(uuid, text, jsonb, jsonb), club_event_groups_check(uuid, uuid[]) from public, anon, authenticated;

-- Создание: черновик или активное. Обязательны название, дата, базовая стоимость; время необязательно.
create or replace function club_event_create(p_name text, p_description text, p_date date, p_time time, p_place text, p_price numeric,
                                             p_deadline timestamp, p_capacity int, p_group_ids uuid[], p_status text default 'draft') returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; r uuid; gs uuid[];
begin
  c := club_event_assert_admin();
  if p_status is null or p_status not in ('draft', 'active') then raise exception 'bad status' using errcode = '22023'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'bad name' using errcode = '22023'; end if;
  if p_description is not null and length(p_description) > 2000 then raise exception 'bad description' using errcode = '22023'; end if;
  if p_place is not null and length(p_place) > 200 then raise exception 'bad place' using errcode = '22023'; end if;
  if p_date is null then raise exception 'date required' using errcode = '22023'; end if;
  if p_price is null or p_price < 0 or p_price <> round(p_price, 2) or p_price >= 100000000 then raise exception 'bad price' using errcode = '22023'; end if;
  if p_capacity is not null and p_capacity < 1 then raise exception 'bad capacity' using errcode = '22023'; end if;
  gs := club_event_groups_check(c, p_group_ids);
  insert into club_events (club_id, name, description, starts_on, starts_time, place, base_price, signup_deadline, capacity, status, created_by, updated_by)
    values (c, btrim(p_name), nullif(btrim(p_description), ''), p_date, p_time, nullif(btrim(p_place), ''), p_price, p_deadline, p_capacity, p_status,
            current_user_id(), current_user_id())
    returning id into r;
  insert into club_event_groups (event_id, group_id) select r, g from unnest(gs) g;
  perform club_event_log_add(r, 'created', null, club_event_snapshot(r));
  return r;
end $$;

-- Правка: p_patch — объект с полями name, description, starts_on, starts_time, place, base_price, signup_deadline, capacity, group_ids.
-- Поле со значением null очищает необязательное значение (время, описание, место, дедлайн, лимит, группы). Дату очистить нельзя. Статус меняется только club_event_set_status.
-- Изменение базовой цены требует причину (не короче 3 символов после trim) и пишет историю цен; то же значение ничего не пишет.
-- p_confirm: контракт предупреждений (смена даты при записанных, лимит ниже числа записанных) включается, когда появятся участники.
create or replace function club_event_update(p_id uuid, p_patch jsonb, p_reason text default null, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ev club_events; c uuid; k text; v jsonb; before_s jsonb; after_s jsonb; np numeric; gs uuid[]; cur uuid[];
        n_name text; n_desc text; n_date date; n_time time; n_place text; n_price numeric; n_dead timestamp; n_cap int;
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
  return jsonb_build_object('applied', true, 'warnings', '[]'::jsonb);
end $$;

-- Смена статуса (P1): черновик → активное; активное → завершённое или отменённое; отменённое → активное.
-- Черновик → отменённое нельзя, «Завершённое» конечное. Удаления черновика нет.
create or replace function club_event_set_status(p_id uuid, p_to text) returns void
language plpgsql security definer set search_path = public as $$
declare ev club_events; c uuid;
begin
  c := club_event_assert_admin();
  if p_to is null or p_to not in ('draft', 'active', 'finished', 'cancelled') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into ev from club_events where id = p_id for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if ev.club_id <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  if not ((ev.status = 'draft' and p_to = 'active')
       or (ev.status = 'active' and p_to in ('finished', 'cancelled'))
       or (ev.status = 'cancelled' and p_to = 'active')) then
    raise exception 'transition not allowed' using errcode = '55000';
  end if;
  update club_events set status = p_to, updated_at = now(), updated_by = current_user_id() where id = p_id;
  perform club_event_log_add(p_id, 'status', jsonb_build_object('status', ev.status), jsonb_build_object('status', p_to));
end $$;

-- Список клуба вызывающего (массив объектов), по желанию с фильтром по статусу.
-- Порядок (EV13): черновики и активные сверху по дате (ближайшие первыми), завершённые и отменённые ниже (свежие первыми).
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
    'club_wide', not exists (select 1 from club_event_groups g where g.event_id = e.id),
    'group_ids', coalesce((select jsonb_agg(g.group_id order by g.group_id) from club_event_groups g where g.event_id = e.id), '[]'::jsonb),
    'group_names', coalesce((select jsonb_agg(gr.name order by gr.name) from club_event_groups g join groups gr on gr.id = g.group_id where g.event_id = e.id), '[]'::jsonb));
end $$;

create or replace function club_event_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid; ec uuid;
begin
  c := club_event_assert_admin();
  select club_id into ec from club_events where id = p_id;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if ec <> c then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'actor_id', l.actor_id, 'action', l.action, 'before', l.before, 'after', l.after) order by l.at, l.id)
                       from club_event_log l where l.event_id = p_id), '[]'::jsonb),
    'price_log', coalesce((select jsonb_agg(jsonb_build_object('at', x.at, 'actor_id', x.actor_id, 'scope', x.scope, 'participant_id', x.participant_id,
                                                              'old_amount', x.old_amount, 'new_amount', x.new_amount, 'reason', x.reason) order by x.at, x.id)
                            from club_event_price_log x where x.event_id = p_id), '[]'::jsonb));
end $$;

revoke execute on function club_event_create(text, text, date, time, text, numeric, timestamp, int, uuid[], text),
  club_event_update(uuid, jsonb, text, boolean), club_event_set_status(uuid, text), club_event_list(text), club_event_get(uuid),
  club_event_history(uuid) from public, anon;
grant execute on function club_event_create(text, text, date, time, text, numeric, timestamp, int, uuid[], text),
  club_event_update(uuid, jsonb, text, boolean), club_event_set_status(uuid, text), club_event_list(text), club_event_get(uuid),
  club_event_history(uuid) to authenticated;
