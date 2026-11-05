-- 0134: подтверждение участия в матчах (RSVP), Issue #274, этап 1, PR 1: модель данных и безопасность.
-- ТЗ: комментарий владельца от 2026-11-05 к Issue #274. Здесь только база данных: без интерфейса, без отправки уведомлений
-- и без cron (только основа журнала напоминаний), без backfill и без изменений существующих данных.
--
-- Что добавляется
--  * matches: жизненный цикл (legacy / draft / published / cancelled), starts_at с часовым поясом, место, адрес, заметка,
--    дедлайн ответа (вычисляемый, Asia/Tbilisi), служебные поля публикации/отмены/переноса;
--  * match_invitations: приглашение игрока на матч, общий ответ семьи (yes / no / нет ответа), кто ответил последним;
--  * match_activity: журнал важных действий (аудит);
--  * match_reminder_log: основа единого лимита напоминаний (24 часа) для автоматических и ручных;
--  * функции match_rsvp_*: все изменения идут только через них, прямой записи в новые таблицы у клиентов нет.
--
-- Совместимость: match_players, match_fees, point_events, save_match и остальные существующие функции не меняются.
-- Существующие матчи получают lifecycle_status = 'legacy' и приглашений не получают. Колонка по умолчанию 'legacy':
-- матч, созданный старыми путями (save_match, save_match_team, импорт), остаётся видимым родителям как раньше;
-- «черновик» создаёт только match_rsvp_create_draft.

-- ============================== matches ==============================
alter table matches
  add column lifecycle_status text not null default 'legacy'
    check (lifecycle_status in ('legacy', 'draft', 'published', 'cancelled')),
  add column starts_at timestamptz,
  add column venue text,
  add column address text,
  add column notes text,
  add column created_by uuid references users(id) on delete set null,
  add column published_at timestamptz,
  add column published_by uuid references users(id) on delete set null,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references users(id) on delete set null,
  add column cancel_reason text,
  add column rescheduled_count int not null default 0,
  add column rescheduled_at timestamptz,
  add constraint matches_rsvp_shape check (lifecycle_status = 'legacy' or starts_at is not null),
  add constraint matches_id_club_unique unique (id, club_id);

-- Время хранится как timestamptz. Дедлайн = за 24 часа до начала по часам Asia/Tbilisi.
create or replace function match_rsvp_deadline(s timestamptz) returns timestamptz
language sql immutable as $$
  select ((s at time zone 'Asia/Tbilisi') - interval '24 hours') at time zone 'Asia/Tbilisi'
$$;

-- До какого момента родитель может менять ответ: до дедлайна, а если дедлайн уже прошёл (поздняя публикация,
-- игрок добавлен после дедлайна, перенос на близкое время) — до начала матча.
create or replace function match_rsvp_answer_until(s timestamptz) returns timestamptz
language sql volatile as $$
  select case when clock_timestamp() > match_rsvp_deadline(s) then s else match_rsvp_deadline(s) end
$$;

alter table matches add column rsvp_deadline_at timestamptz generated always as (match_rsvp_deadline(starts_at)) stored;

-- Допустимые переходы состояния (защита и от прямой записи администратора): legacy остаётся legacy,
-- draft -> published -> cancelled, отменённый матч не восстанавливается, опубликованный не возвращается в черновик.
-- Опубликованный и отменённый матч удалить нельзя.
create or replace function matches_lifecycle_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.lifecycle_status in ('published', 'cancelled') then
      raise exception 'published match cannot be deleted' using errcode = '55000';
    end if;
    return old;
  end if;
  if new.lifecycle_status is distinct from old.lifecycle_status and not (
       (old.lifecycle_status = 'draft' and new.lifecycle_status = 'published')
    or (old.lifecycle_status = 'published' and new.lifecycle_status = 'cancelled')) then
    raise exception 'bad lifecycle transition % -> %', old.lifecycle_status, new.lifecycle_status using errcode = '55000';
  end if;
  return new;
end $$;
create trigger matches_lifecycle_guard_upd before update of lifecycle_status on matches
  for each row execute function matches_lifecycle_guard();
create trigger matches_lifecycle_guard_del before delete on matches
  for each row execute function matches_lifecycle_guard();

-- Для составного внешнего ключа: игрок приглашается только в матч своего клуба (проверка на уровне БД).
alter table players add constraint players_id_club_unique unique (id, club_id);

-- ============================== таблицы ==============================
create table match_invitations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null,
  club_id uuid not null,
  player_id uuid not null,
  status text not null default 'invited' check (status in ('invited', 'removed')),
  response text check (response in ('yes', 'no')),            -- null = «Не ответил»; это не вариант ответа родителя
  responded_by uuid references users(id) on delete set null,   -- кто установил ответ последним (родитель или тренер)
  responded_by_coach boolean not null default false,
  responded_at timestamptz,
  answer_until timestamptz,                                    -- до какого момента родитель может менять ответ; null у черновика
  invited_at timestamptz not null default now(),
  invited_by uuid references users(id) on delete set null,
  removed_at timestamptz,
  removed_by uuid references users(id) on delete set null,
  reinvite_count int not null default 0,
  unique (match_id, player_id),
  foreign key (match_id, club_id) references matches (id, club_id) on delete cascade,
  foreign key (player_id, club_id) references players (id, club_id) on delete cascade,
  check ((response is null) = (responded_at is null))
);
create index match_invitations_player on match_invitations (player_id);

create table match_activity (
  id bigint generated always as identity primary key,
  match_id uuid not null,
  club_id uuid not null,
  actor_id uuid references users(id) on delete set null,
  action text not null check (action in ('created', 'published', 'details_changed', 'rescheduled', 'cancelled',
    'players_invited', 'players_removed', 'coach_response', 'manual_reminder')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (match_id, club_id) references matches (id, club_id) on delete cascade
);
create index match_activity_match on match_activity (match_id, id);

-- Основа единого лимита напоминаний. Доставки здесь нет (PR 2): запись означает «напоминание поставлено в очередь».
create table match_reminder_log (
  id bigint generated always as identity primary key,
  match_id uuid not null,
  club_id uuid not null,
  recipient_id uuid not null references users(id) on delete cascade,   -- родитель
  kind text not null check (kind in ('manual', 'auto_48h', 'auto_24h')),
  schedule_version int not null default 0,                             -- matches.rescheduled_count на момент постановки
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  sent_by uuid references users(id) on delete set null,                -- тренер для ручного
  created_at timestamptz not null default clock_timestamp(),
  foreign key (match_id, club_id) references matches (id, club_id) on delete cascade
);
create index match_reminder_log_recent on match_reminder_log (match_id, recipient_id, created_at desc);
-- Автоматическое напоминание каждого вида — один раз на родителя, матч и версию расписания (защита от дублей cron)
create unique index match_reminder_log_auto_once on match_reminder_log (match_id, recipient_id, kind, schedule_version)
  where kind in ('auto_48h', 'auto_24h');

-- В Supabase новым таблицам по умолчанию выдаются все права: отзываем, оставляем только чтение под RLS.
revoke all on match_invitations, match_activity, match_reminder_log from public, anon, authenticated;
grant select on match_invitations, match_activity, match_reminder_log to authenticated;
grant all on match_invitations, match_activity, match_reminder_log to service_role;
alter table match_invitations enable row level security;
alter table match_activity enable row level security;
alter table match_reminder_log enable row level security;

-- ============================== проверки доступа ==============================
-- Тренер клуба: состоит хотя бы в одной группе этого клуба (тренеры ведут все группы своего клуба, чужого клуба — нет).
create or replace function is_coach_of_club(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from coach_groups cg join groups g on g.id = cg.group_id
                  where cg.user_id = current_user_id() and g.club_id = c)
$$;
-- Администратор в этой схеме не привязан к клубу (users.is_admin), как и во всех остальных проверках.
create or replace function is_match_staff(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select current_user_id() is not null and (is_admin() or is_coach_of_club(c))
$$;
-- Матч уже опубликован (виден родителям). Возвращает только признак, без данных матча.
create or replace function rsvp_match_visible(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from matches where id = m and lifecycle_status in ('published', 'cancelled'))
$$;
-- У текущего пользователя есть ребёнок, приглашённый на этот матч (связь действует, согласие не отозвано).
create or replace function rsvp_is_invited_guardian(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from match_invitations i
    where i.match_id = m and i.status = 'invited' and is_guardian_of(i.player_id)
  )
$$;
revoke execute on function is_coach_of_club(uuid), is_match_staff(uuid), rsvp_match_visible(uuid), rsvp_is_invited_guardian(uuid) from public, anon;
grant execute on function is_coach_of_club(uuid), is_match_staff(uuid), rsvp_match_visible(uuid), rsvp_is_invited_guardian(uuid) to authenticated;
revoke execute on function match_rsvp_deadline(timestamptz), match_rsvp_answer_until(timestamptz) from public, anon;
grant execute on function match_rsvp_deadline(timestamptz), match_rsvp_answer_until(timestamptz) to authenticated;

-- ============================== RLS ==============================
-- Чтение матчей: как раньше (администратор; команда, которую видит тренер/родитель; участие игрока), но
--  * черновик видят только администратор и тренеры клуба;
--  * тренер видит матчи только своего клуба (раньше is_any_coach() не смотрел на клуб);
--  * родитель видит матч, на который приглашён его ребёнок, даже если команда другая.
drop policy if exists matches_read on matches;
create policy matches_read on matches for select using (
  is_admin()
  or is_coach_of_club(club_id)
  or (
    lifecycle_status <> 'draft'
    and (
      can_see_team(club_id, team)
      or exists (select 1 from match_players mp where mp.match_id = matches.id and is_guardian_of(mp.player_id))
      or rsvp_is_invited_guardian(id)
    )
  )
);

create policy match_invitations_read on match_invitations for select using (
  is_match_staff(club_id)
  or (status = 'invited' and rsvp_match_visible(match_id) and is_guardian_of(player_id))
);
create policy match_activity_read on match_activity for select using (is_match_staff(club_id));
create policy match_reminder_log_read on match_reminder_log for select using (is_match_staff(club_id));
-- Политик на запись нет и прав на запись у клиентов нет: всё через функции ниже.

-- Приглашение нельзя создать на старый (legacy) матч, даже вставкой напрямую.
create or replace function match_invitations_guard() returns trigger
language plpgsql as $$
begin
  if (select lifecycle_status from matches where id = new.match_id) = 'legacy' then
    raise exception 'legacy match has no invitations' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger match_invitations_guard_ins before insert on match_invitations
  for each row execute function match_invitations_guard();

-- ============================== служебные функции ==============================
create or replace function rsvp_assert_staff(c uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if c is null or not is_match_staff(c) then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

-- Блокирует матч и проверяет доступ. Порядок блокировок везде один: сначала матч, потом приглашения (по player_id).
-- Чужой и несуществующий матч неразличимы: одинаковая ошибка forbidden.
create or replace function rsvp_lock_match(m uuid) returns matches
language plpgsql security definer set search_path = public as $$
declare mt matches;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into mt from matches where id = m for update;
  perform rsvp_assert_staff(mt.club_id);
  if mt.lifecycle_status = 'legacy' then raise exception 'legacy match' using errcode = '55000'; end if;
  return mt;
end $$;

create or replace function rsvp_log(m matches, act text, pl jsonb) returns void
language sql security definer set search_path = public as $$
  insert into match_activity (match_id, club_id, actor_id, action, payload)
    values (m.id, m.club_id, current_user_id(), act, coalesce(pl, '{}'::jsonb))
$$;

-- Ставит напоминание в очередь, если этому родителю по этому матчу не ставили напоминание за последние 24 часа
-- (любого вида: ручное и автоматическое считаются вместе). true — поставлено, false — слишком часто / уже было.
-- Вызывается из match_rsvp_remind_unanswered и (в PR 2) из cron под service_role; клиентам недоступна.
create or replace function rsvp_claim_reminder(m uuid, u uuid, k text, actor uuid default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare mt matches; n int;
begin
  select * into mt from matches where id = m;
  if mt.id is null or mt.lifecycle_status <> 'published' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(m::text || ':' || u::text, 0));
  if exists (select 1 from match_reminder_log where match_id = m and recipient_id = u and created_at > clock_timestamp() - interval '24 hours') then
    return false;
  end if;
  insert into match_reminder_log (match_id, club_id, recipient_id, kind, schedule_version, sent_by)
    values (m, mt.club_id, u, k, mt.rescheduled_count, actor)
    on conflict do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function rsvp_assert_staff(uuid), rsvp_lock_match(uuid), rsvp_log(matches, text, jsonb), rsvp_claim_reminder(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function rsvp_claim_reminder(uuid, uuid, text, uuid) to service_role;

-- ============================== операции тренера и администратора ==============================
-- Создать черновик. Родителям не виден, уведомлений нет. Состав добавляется отдельно (match_rsvp_seed / match_rsvp_invite).
-- p_kind: 'game' — чемпионат, 'friendly' — товарищеский (как matches.kind).
create or replace function match_rsvp_create_draft(p_club uuid, p_kind text, p_team text, p_opponent text, p_starts_at timestamptz,
  p_venue text, p_address text, p_notes text, p_tournament uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare mt matches;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_club is null or not is_match_staff(p_club) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('game', 'friendly') then raise exception 'bad kind' using errcode = '22023'; end if;
  if nullif(trim(p_team), '') is null then raise exception 'team required' using errcode = '22023'; end if;
  if p_starts_at is null then raise exception 'start time required' using errcode = '22023'; end if;
  if p_tournament is not null and not exists (select 1 from tournaments where id = p_tournament and club_id = p_club) then
    raise exception 'tournament is not of this club' using errcode = '42501';
  end if;
  insert into matches (club_id, played_on, team, opponent, kind, tournament_id, lifecycle_status, starts_at, venue, address, notes, created_by)
    values (p_club, tbilisi_day(p_starts_at), trim(p_team), nullif(trim(p_opponent), ''), p_kind, p_tournament, 'draft', p_starts_at,
            nullif(trim(p_venue), ''), nullif(trim(p_address), ''), nullif(trim(p_notes), ''), current_user_id())
    returning * into mt;
  perform rsvp_log(mt, 'created', jsonb_build_object('kind', p_kind, 'team', mt.team, 'starts_at', p_starts_at));
  return mt.id;
end $$;

-- Изменить параметры. Черновик правится свободно. У опубликованного до начала матча: соперник, место, адрес, заметка
-- и время в пределах того же дня (ответы сохраняются, дедлайн пересчитывается); смена даты — только через
-- match_rsvp_reschedule (там сброс ответов). После начала, у отменённого и у legacy матча изменений нет.
-- p — jsonb с ключами: opponent, venue, address, notes, starts_at, kind, team, tournament_id (kind, team, tournament_id — только в черновике).
create or replace function match_rsvp_update(m uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches; k text; nw matches; b_ jsonb := '{}'::jsonb; a_ jsonb := '{}'::jsonb; ns timestamptz;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'bad payload' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('opponent', 'venue', 'address', 'notes', 'starts_at', 'kind', 'team', 'tournament_id') then
      raise exception 'unknown field %', k using errcode = '22023';
    end if;
  end loop;
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status = 'cancelled' then raise exception 'match is cancelled' using errcode = '55000'; end if;
  if mt.lifecycle_status = 'published' then
    if clock_timestamp() >= mt.starts_at then raise exception 'match already started' using errcode = '55000'; end if;
    if p ?| array['kind', 'team', 'tournament_id'] then raise exception 'field is fixed after publish' using errcode = '55000'; end if;
  end if;
  nw := mt;
  if p ? 'opponent' then nw.opponent := nullif(trim(p->>'opponent'), ''); end if;
  if p ? 'venue' then nw.venue := nullif(trim(p->>'venue'), ''); end if;
  if p ? 'address' then nw.address := nullif(trim(p->>'address'), ''); end if;
  if p ? 'notes' then nw.notes := nullif(trim(p->>'notes'), ''); end if;
  if p ? 'kind' then
    if (p->>'kind') is null or p->>'kind' not in ('game', 'friendly') then raise exception 'bad kind' using errcode = '22023'; end if;
    nw.kind := p->>'kind';
  end if;
  if p ? 'team' then
    if nullif(trim(p->>'team'), '') is null then raise exception 'team required' using errcode = '22023'; end if;
    nw.team := trim(p->>'team');
  end if;
  if p ? 'tournament_id' then
    nw.tournament_id := nullif(p->>'tournament_id', '')::uuid;
    if nw.tournament_id is not null and not exists (select 1 from tournaments where id = nw.tournament_id and club_id = mt.club_id) then
      raise exception 'tournament is not of this club' using errcode = '42501';
    end if;
  end if;
  if p ? 'starts_at' then
    ns := (p->>'starts_at')::timestamptz;
    if ns is null then raise exception 'start time required' using errcode = '22023'; end if;
    if mt.lifecycle_status = 'published' then
      if ns <= clock_timestamp() then raise exception 'start in the past' using errcode = '22023'; end if;
      if tbilisi_day(ns) <> tbilisi_day(mt.starts_at) then raise exception 'date change requires reschedule' using errcode = '55000'; end if;
    end if;
    nw.starts_at := ns;
  end if;
  if (nw.opponent, nw.venue, nw.address, nw.notes, nw.kind, nw.team, nw.tournament_id, nw.starts_at)
     is not distinct from (mt.opponent, mt.venue, mt.address, mt.notes, mt.kind, mt.team, mt.tournament_id, mt.starts_at) then
    return;
  end if;
  update matches set opponent = nw.opponent, venue = nw.venue, address = nw.address, notes = nw.notes, kind = nw.kind, team = nw.team,
    tournament_id = nw.tournament_id, starts_at = nw.starts_at, played_on = tbilisi_day(nw.starts_at) where id = m;
  if mt.lifecycle_status = 'published' then
    if nw.opponent is distinct from mt.opponent then b_ := b_ || jsonb_build_object('opponent', mt.opponent); a_ := a_ || jsonb_build_object('opponent', nw.opponent); end if;
    if nw.venue is distinct from mt.venue then b_ := b_ || jsonb_build_object('venue', mt.venue); a_ := a_ || jsonb_build_object('venue', nw.venue); end if;
    if nw.address is distinct from mt.address then b_ := b_ || jsonb_build_object('address', mt.address); a_ := a_ || jsonb_build_object('address', nw.address); end if;
    if nw.notes is distinct from mt.notes then b_ := b_ || jsonb_build_object('notes', mt.notes); a_ := a_ || jsonb_build_object('notes', nw.notes); end if;
    if nw.starts_at is distinct from mt.starts_at then
      b_ := b_ || jsonb_build_object('starts_at', mt.starts_at); a_ := a_ || jsonb_build_object('starts_at', nw.starts_at);
      -- дедлайн пересчитан от нового времени (matches.rsvp_deadline_at вычисляется сам), окно ответа — тоже
      update match_invitations set answer_until = match_rsvp_answer_until(nw.starts_at) where match_id = m and status = 'invited';
    end if;
    perform rsvp_log(mt, 'details_changed', jsonb_build_object('before', b_, 'after', a_));
  end if;
end $$;

-- Добавить в состав черновика игроков группы (снимок на момент вызова: позже изменение группы матч не меняет)
-- или, если группа не указана, игроков списка события (tournament_fees) из matches.tournament_id. Только активные игроки клуба.
create or replace function match_rsvp_seed(m uuid, p_group uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare mt matches; n int;
begin
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status <> 'draft' then raise exception 'only draft can be seeded' using errcode = '55000'; end if;
  if p_group is not null then
    if not exists (select 1 from groups where id = p_group and club_id = mt.club_id) then raise exception 'group is not of this club' using errcode = '42501'; end if;
    insert into match_invitations (match_id, club_id, player_id, invited_by)
      select m, mt.club_id, p.id, current_user_id() from players p
       where p.group_id = p_group and p.club_id = mt.club_id and p.status = 'active'
       order by p.id
      on conflict (match_id, player_id) do nothing;
  else
    if mt.tournament_id is null then raise exception 'no event to take the roster from' using errcode = '22023'; end if;
    insert into match_invitations (match_id, club_id, player_id, invited_by)
      select m, mt.club_id, p.id, current_user_id() from tournament_fees f join players p on p.id = f.player_id
       where f.tournament_id = mt.tournament_id and p.club_id = mt.club_id and p.status = 'active'
       order by p.id
      on conflict (match_id, player_id) do nothing;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- Добавить игроков. Черновик: просто строки состава. Опубликованный матч до начала: новый игрок получает «Не ответил»,
-- ответить может до дедлайна, а если он прошёл — до начала матча; исключённый ранее приглашается заново с чистым ответом
-- (прежний ответ остаётся в журнале). Игрок другого клуба — ошибка для всей операции.
create or replace function match_rsvp_invite(m uuid, p_players uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare mt matches; pid uuid; inv match_invitations; added uuid[] := '{}'; readded jsonb := '[]'::jsonb; v_until timestamptz;
begin
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status = 'cancelled' then raise exception 'match is cancelled' using errcode = '55000'; end if;
  if mt.lifecycle_status = 'published' and clock_timestamp() >= mt.starts_at then raise exception 'match already started' using errcode = '55000'; end if;
  if p_players is null or cardinality(p_players) = 0 then return 0; end if;
  if exists (select 1 from unnest(p_players) x where not exists (select 1 from players p where p.id = x and p.club_id = mt.club_id)) then
    raise exception 'player is not of this club' using errcode = '42501';
  end if;
  v_until := case when mt.lifecycle_status = 'published' then match_rsvp_answer_until(mt.starts_at) end;
  for pid in select distinct x from unnest(p_players) x order by x loop
    select * into inv from match_invitations where match_id = m and player_id = pid for update;
    if inv.id is null then
      insert into match_invitations (match_id, club_id, player_id, answer_until, invited_by) values (m, mt.club_id, pid, v_until, current_user_id());
      added := added || pid;
    elsif inv.status = 'removed' then
      readded := readded || jsonb_build_object('player_id', pid, 'previous_response', inv.response, 'previous_responded_by', inv.responded_by, 'previous_responded_at', inv.responded_at);
      update match_invitations set status = 'invited', response = null, responded_by = null, responded_by_coach = false, responded_at = null,
        answer_until = v_until, invited_at = clock_timestamp(), invited_by = current_user_id(), removed_at = null, removed_by = null,
        reinvite_count = reinvite_count + 1 where id = inv.id;
    end if;
  end loop;
  if mt.lifecycle_status = 'published' and (cardinality(added) > 0 or jsonb_array_length(readded) > 0) then
    perform rsvp_log(mt, 'players_invited', jsonb_build_object('added', to_jsonb(added), 'readded', readded));
  end if;
  return cardinality(added) + jsonb_array_length(readded);
end $$;

-- Исключить игроков. Черновик: строки удаляются. Опубликованный до начала: статус removed, ответ сохраняется в строке и в журнале.
create or replace function match_rsvp_remove(m uuid, p_players uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare mt matches; removed jsonb := '[]'::jsonb; r record; n int := 0;
begin
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status = 'cancelled' then raise exception 'match is cancelled' using errcode = '55000'; end if;
  if mt.lifecycle_status = 'published' and clock_timestamp() >= mt.starts_at then raise exception 'match already started' using errcode = '55000'; end if;
  if p_players is null or cardinality(p_players) = 0 then return 0; end if;
  for r in select * from match_invitations where match_id = m and player_id = any (p_players) and status = 'invited' order by player_id for update loop
    if mt.lifecycle_status = 'draft' then
      delete from match_invitations where id = r.id;
    else
      update match_invitations set status = 'removed', removed_at = clock_timestamp(), removed_by = current_user_id() where id = r.id;
      removed := removed || jsonb_build_object('player_id', r.player_id, 'response', r.response, 'responded_by', r.responded_by, 'responded_at', r.responded_at);
    end if;
    n := n + 1;
  end loop;
  if mt.lifecycle_status = 'published' and n > 0 then
    perform rsvp_log(mt, 'players_removed', jsonb_build_object('removed', removed));
  end if;
  return n;
end $$;

-- Опубликовать: нужен хотя бы один приглашённый и время начала в будущем. Дальше родители видят матч и могут отвечать.
create or replace function match_rsvp_publish(m uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches; n int;
begin
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status <> 'draft' then raise exception 'only draft can be published' using errcode = '55000'; end if;
  if mt.starts_at <= clock_timestamp() then raise exception 'start in the past' using errcode = '22023'; end if;
  select count(*) into n from match_invitations where match_id = m and status = 'invited';
  if n = 0 then raise exception 'no invited players' using errcode = '22023'; end if;
  update matches set lifecycle_status = 'published', published_at = clock_timestamp(), published_by = current_user_id() where id = m;
  update match_invitations set answer_until = match_rsvp_answer_until(mt.starts_at), invited_at = clock_timestamp() where match_id = m and status = 'invited';
  perform rsvp_log(mt, 'published', jsonb_build_object('invited', n, 'deadline', mt.rsvp_deadline_at));
end $$;

-- Удалить черновик окончательно (вместе с составом и журналом). Опубликованный матч удалить нельзя — только отменить.
create or replace function match_rsvp_delete_draft(m uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches;
begin
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status <> 'draft' then raise exception 'only draft can be deleted' using errcode = '55000'; end if;
  insert into audit_log (actor_id, action, entity, entity_id, before) values (current_user_id(), 'delete_match_draft', 'matches', m, to_jsonb(mt));
  delete from matches where id = m;
end $$;

-- Отменить опубликованный матч (в том числе после начала). Необратимо; ответы и журнал остаются, отвечать больше нельзя.
create or replace function match_rsvp_cancel(m uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches;
begin
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status = 'draft' then raise exception 'draft is deleted, not cancelled' using errcode = '55000'; end if;
  if mt.lifecycle_status <> 'published' then raise exception 'match is already cancelled' using errcode = '55000'; end if;
  update matches set lifecycle_status = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = current_user_id(),
    cancel_reason = nullif(trim(p_reason), '') where id = m;
  perform rsvp_log(mt, 'cancelled', jsonb_build_object('reason', nullif(trim(p_reason), ''), 'was_started', clock_timestamp() >= mt.starts_at));
end $$;

-- Перенести опубликованный матч (в том числе после начала): тот же матч, новое время (и при необходимости место).
-- Все ответы приглашённых сбрасываются на «Не ответил» (прежние сохраняются в журнале), окно ответа открывается заново,
-- дедлайн пересчитывается. Список приглашённых сохраняется. ВАЖНО: фактические отметки (match_players) и баллы здесь НЕ
-- меняются, чтобы не затрагивать существующую систему баллов; в журнал пишется признак, что отметки были (вопрос владельцу).
create or replace function match_rsvp_reschedule(m uuid, p_starts_at timestamptz, p_venue text default null, p_address text default null) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches; snap jsonb; marks boolean;
begin
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status <> 'published' then raise exception 'only published match can be rescheduled' using errcode = '55000'; end if;
  if p_starts_at is null or p_starts_at <= clock_timestamp() then raise exception 'start in the past' using errcode = '22023'; end if;
  if p_starts_at = mt.starts_at then raise exception 'start time not changed' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('player_id', player_id, 'response', response, 'responded_by', responded_by, 'responded_at', responded_at)
           order by player_id), '[]'::jsonb) into snap
    from match_invitations where match_id = m and status = 'invited' and response is not null;
  select exists (select 1 from match_players where match_id = m and played) into marks;
  update match_invitations set response = null, responded_by = null, responded_by_coach = false, responded_at = null,
    answer_until = match_rsvp_answer_until(p_starts_at) where match_id = m and status = 'invited';
  update matches set starts_at = p_starts_at, played_on = tbilisi_day(p_starts_at),
    venue = coalesce(nullif(trim(p_venue), ''), venue), address = coalesce(nullif(trim(p_address), ''), address),
    rescheduled_count = rescheduled_count + 1, rescheduled_at = clock_timestamp() where id = m;
  perform rsvp_log(mt, 'rescheduled', jsonb_build_object('previous_starts_at', mt.starts_at, 'new_starts_at', p_starts_at,
    'previous_venue', mt.venue, 'previous_address', mt.address, 'was_started', clock_timestamp() >= mt.starts_at,
    'reset_responses', snap, 'fact_marks_present', marks));
end $$;

-- Тренер или администратор ставит ответ «Будет»/«Не будет» вручную (в том числе после дедлайна, до начала матча).
create or replace function match_rsvp_coach_set(m uuid, p_player uuid, p_response text) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches; inv match_invitations;
begin
  if p_response is null or p_response not in ('yes', 'no') then raise exception 'bad response' using errcode = '22023'; end if;
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status <> 'published' then raise exception 'match is not published' using errcode = '55000'; end if;
  if clock_timestamp() >= mt.starts_at then raise exception 'match already started' using errcode = '55000'; end if;
  select * into inv from match_invitations where match_id = m and player_id = p_player and status = 'invited' for update;
  if inv.id is null then raise exception 'player is not invited' using errcode = 'P0002'; end if;
  update match_invitations set response = p_response, responded_by = current_user_id(), responded_by_coach = true, responded_at = clock_timestamp()
    where id = inv.id;
  perform rsvp_log(mt, 'coach_response', jsonb_build_object('player_id', p_player, 'before', inv.response, 'after', p_response,
    'after_deadline', clock_timestamp() > inv.answer_until));
end $$;

-- «Напомнить не ответившим»: ставит в очередь напоминания родителям (действующая связь, согласие не отозвано) игроков
-- со статусом «Не ответил». Одному родителю не чаще раза в 24 часа (общий лимит с автоматическими). Сами сообщения не
-- отправляются (PR 2). Возвращает число родителей, которым напоминание поставлено, и пропущенных из-за лимита.
create or replace function match_rsvp_remind_unanswered(m uuid) returns table (queued int, skipped int)
language plpgsql security definer set search_path = public as $$
declare mt matches; u uuid; q int := 0; s int := 0;
begin
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status <> 'published' then raise exception 'match is not published' using errcode = '55000'; end if;
  if clock_timestamp() >= mt.starts_at then raise exception 'match already started' using errcode = '55000'; end if;
  for u in
    select distinct g.user_id from match_invitations i join player_guardians g on g.player_id = i.player_id and g.consent_revoked_at is null
     where i.match_id = m and i.status = 'invited' and i.response is null order by g.user_id
  loop
    if rsvp_claim_reminder(m, u, 'manual', current_user_id()) then q := q + 1; else s := s + 1; end if;
  end loop;
  if q > 0 then perform rsvp_log(mt, 'manual_reminder', jsonb_build_object('queued', q, 'skipped', s)); end if;
  return query select q, s;
end $$;

-- Сводка для тренера: приглашено / будет / не будет / не ответил, число ручных напоминаний и время последнего.
create or replace function match_rsvp_summary(m uuid) returns table (invited int, yes int, no int, unanswered int, reminders int, last_reminder_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform rsvp_assert_staff((select mt.club_id from matches mt where mt.id = m));
  return query
    select count(*)::int, (count(*) filter (where i.response = 'yes'))::int, (count(*) filter (where i.response = 'no'))::int,
           (count(*) filter (where i.response is null))::int,
           (select count(*)::int from match_activity a where a.match_id = m and a.action = 'manual_reminder'),
           (select max(a.created_at) from match_activity a where a.match_id = m and a.action = 'manual_reminder')
      from match_invitations i where i.match_id = m and i.status = 'invited';
end $$;

-- Полный список для тренера: имя, группа, ответ, кто и когда ответил.
create or replace function match_rsvp_roster(m uuid)
returns table (player_id uuid, full_name text, group_name text, status text, response text, responded_by_name text, responded_by_coach boolean, responded_at timestamptz, answer_until timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform rsvp_assert_staff((select mt.club_id from matches mt where mt.id = m));
  return query
    select i.player_id, p.full_name, g.name, i.status, i.response, u.display_name, i.responded_by_coach, i.responded_at, i.answer_until
      from match_invitations i join players p on p.id = i.player_id left join groups g on g.id = p.group_id left join users u on u.id = i.responded_by
     where i.match_id = m order by p.full_name;
end $$;

-- ============================== операции родителя ==============================
-- Ответ за ребёнка: «Будет»/«Не будет». Ответ один на ребёнка, общий для обоих родителей. Доступ — действующая связь с
-- согласием (is_guardian_of). Закрыто: матч не опубликован/отменён, началось время, прошёл срок ответа, ребёнок исключён.
create or replace function match_rsvp_answer(m uuid, p_player uuid, p_response text) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches; inv match_invitations;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_response is null or p_response not in ('yes', 'no') then raise exception 'bad response' using errcode = '22023'; end if;
  if not is_guardian_of(p_player) then raise exception 'forbidden' using errcode = '42501'; end if;
  -- матч блокируется на чтение: ответы не мешают друг другу, но ждут перенос/отмену/изменение времени
  select * into mt from matches where id = m for share;
  if mt.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into inv from match_invitations where match_id = m and player_id = p_player for update;
  if inv.id is null or inv.status <> 'invited' or mt.lifecycle_status not in ('published', 'cancelled') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if mt.lifecycle_status = 'cancelled' then raise exception 'match is cancelled' using errcode = '55000'; end if;
  if clock_timestamp() >= mt.starts_at or clock_timestamp() > inv.answer_until then
    raise exception 'answers are closed' using errcode = '55000';
  end if;
  update match_invitations set response = p_response, responded_by = current_user_id(), responded_by_coach = false, responded_at = clock_timestamp()
    where id = inv.id;
end $$;

-- Ответ за нескольких детей одной операцией: [{"player_id": "...", "response": "yes"}, ...]; при ошибке не сохраняется ничего.
create or replace function match_rsvp_answer_many(m uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare el jsonb;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then raise exception 'bad payload' using errcode = '22023'; end if;
  -- порядок по player_id: одинаковый порядок блокировок у параллельных вызовов
  for el in select x.v from jsonb_array_elements(p_answers) as x(v) order by x.v->>'player_id' loop
    perform match_rsvp_answer(m, (el->>'player_id')::uuid, el->>'response');
  end loop;
end $$;

-- Матчи, на которые приглашены дети текущего пользователя (только опубликованные и отменённые, только свои дети).
-- Чужие семьи, список других игроков и статистика не возвращаются. Имя второго родителя видно как автор ответа.
create or replace function match_rsvp_my_matches()
returns table (match_id uuid, lifecycle_status text, kind text, team text, opponent text, starts_at timestamptz, venue text, address text, notes text,
  rescheduled boolean, player_id uuid, player_name text, response text, responded_by_name text, responded_at timestamptz, answer_until timestamptz, can_answer boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
    select mt.id, mt.lifecycle_status, mt.kind, mt.team, mt.opponent, mt.starts_at, mt.venue, mt.address, mt.notes, mt.rescheduled_count > 0,
           i.player_id, p.full_name, i.response, u.display_name, i.responded_at, i.answer_until,
           (mt.lifecycle_status = 'published' and clock_timestamp() < mt.starts_at and clock_timestamp() <= i.answer_until)
      from match_invitations i
      join matches mt on mt.id = i.match_id
      join players p on p.id = i.player_id
      left join users u on u.id = i.responded_by
     where i.status = 'invited' and mt.lifecycle_status in ('published', 'cancelled') and is_guardian_of(i.player_id)
     order by mt.starts_at, p.full_name;
end $$;

revoke execute on function
  match_rsvp_create_draft(uuid, text, text, text, timestamptz, text, text, text, uuid), match_rsvp_update(uuid, jsonb), match_rsvp_seed(uuid, uuid),
  match_rsvp_invite(uuid, uuid[]), match_rsvp_remove(uuid, uuid[]), match_rsvp_publish(uuid), match_rsvp_delete_draft(uuid), match_rsvp_cancel(uuid, text),
  match_rsvp_reschedule(uuid, timestamptz, text, text), match_rsvp_coach_set(uuid, uuid, text), match_rsvp_remind_unanswered(uuid),
  match_rsvp_summary(uuid), match_rsvp_roster(uuid), match_rsvp_answer(uuid, uuid, text), match_rsvp_answer_many(uuid, jsonb), match_rsvp_my_matches()
  from public, anon;
grant execute on function
  match_rsvp_create_draft(uuid, text, text, text, timestamptz, text, text, text, uuid), match_rsvp_update(uuid, jsonb), match_rsvp_seed(uuid, uuid),
  match_rsvp_invite(uuid, uuid[]), match_rsvp_remove(uuid, uuid[]), match_rsvp_publish(uuid), match_rsvp_delete_draft(uuid), match_rsvp_cancel(uuid, text),
  match_rsvp_reschedule(uuid, timestamptz, text, text), match_rsvp_coach_set(uuid, uuid, text), match_rsvp_remind_unanswered(uuid),
  match_rsvp_summary(uuid), match_rsvp_roster(uuid), match_rsvp_answer(uuid, uuid, text), match_rsvp_answer_many(uuid, jsonb), match_rsvp_my_matches()
  to authenticated;
