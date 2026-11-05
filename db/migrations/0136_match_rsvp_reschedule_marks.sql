-- 0136: перенос матча и фактические отметки (Issue #274, этап 1, продолжение 0134; решение владельца 2026-11-05 «Снимок и сброс»).
-- Проблема 0134: перенос менял matches.played_on и не трогал отметки. У уже отмеченного матча баллы за матч (миграция 0122,
-- отложенные триггеры на matches и match_players) переезжали бы на новую дату, а «играл» и счёт оставались от несыгранной игры.
-- Теперь: если у матча есть отметки или счёт, перед переносом сохраняется полный снимок (match_mark_snapshots), затем отметки
-- и счёт обнуляются. Баллы за матч существующие триггеры пересчитывают сами; после нового проведения тренер отмечает игроков заново.
-- Ошибочный перенос можно исправить: match_rsvp_restore_marks возвращает отметки и счёт из снимка (если нового отмечено не было).
-- Строки match_players не удаляются, меняются только played/goals/best. Журнал match_revisions (0122) записывает изменение как обычно.
-- Дополнительно: черновик нельзя создать для завершённого события (как в старом интерфейсе).

create table match_mark_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null,
  club_id uuid not null,
  reason text not null default 'reschedule' check (reason in ('reschedule')),
  taken_at timestamptz not null default now(),
  taken_by uuid references users(id) on delete set null,
  played_on date not null,
  starts_at timestamptz,
  goals_for int,
  goals_against int,
  technical boolean not null,
  players jsonb not null,                 -- строки match_players целиком (to_jsonb)
  restored_at timestamptz,
  restored_by uuid references users(id) on delete set null,
  foreign key (match_id, club_id) references matches (id, club_id) on delete cascade
);
create index match_mark_snapshots_match on match_mark_snapshots (match_id, taken_at);
revoke all on match_mark_snapshots from public, anon, authenticated;
grant select on match_mark_snapshots to authenticated;
grant all on match_mark_snapshots to service_role;
alter table match_mark_snapshots enable row level security;
create policy match_mark_snapshots_read on match_mark_snapshots for select using (is_match_staff(club_id));

alter table match_activity drop constraint match_activity_action_check;
alter table match_activity add constraint match_activity_action_check check (action in ('created', 'published', 'details_changed',
  'rescheduled', 'cancelled', 'players_invited', 'players_removed', 'coach_response', 'manual_reminder', 'marks_restored'));

create or replace function match_rsvp_reschedule(m uuid, p_starts_at timestamptz, p_venue text default null, p_address text default null) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches; snap jsonb; marks boolean; sid uuid;
begin
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status <> 'published' then raise exception 'only published match can be rescheduled' using errcode = '55000'; end if;
  if p_starts_at is null or p_starts_at <= clock_timestamp() then raise exception 'start in the past' using errcode = '22023'; end if;
  if p_starts_at = mt.starts_at then raise exception 'start time not changed' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('player_id', player_id, 'response', response, 'responded_by', responded_by, 'responded_at', responded_at)
           order by player_id), '[]'::jsonb) into snap
    from match_invitations where match_id = m and status = 'invited' and response is not null;
  -- фактические отметки: снимок, затем сброс (строки остаются, баллы пересчитают триггеры 0122)
  marks := mt.goals_for is not null or mt.goals_against is not null or mt.technical
           or exists (select 1 from match_players where match_id = m and (played or goals <> 0 or best));
  if marks then
    insert into match_mark_snapshots (match_id, club_id, taken_by, played_on, starts_at, goals_for, goals_against, technical, players)
      values (m, mt.club_id, current_user_id(), mt.played_on, mt.starts_at, mt.goals_for, mt.goals_against, mt.technical,
              coalesce((select jsonb_agg(to_jsonb(p) order by p.player_id) from match_players p where p.match_id = m), '[]'::jsonb))
      returning id into sid;
    update match_players set played = false, goals = 0, best = false where match_id = m and (played or goals <> 0 or best);
  end if;
  update match_invitations set response = null, responded_by = null, responded_by_coach = false, responded_at = null,
    answer_until = match_rsvp_answer_until(p_starts_at) where match_id = m and status = 'invited';
  update matches set starts_at = p_starts_at, played_on = tbilisi_day(p_starts_at),
    venue = coalesce(nullif(trim(p_venue), ''), venue), address = coalesce(nullif(trim(p_address), ''), address),
    goals_for = case when marks then null else goals_for end, goals_against = case when marks then null else goals_against end,
    technical = case when marks then false else technical end,
    rescheduled_count = rescheduled_count + 1, rescheduled_at = clock_timestamp() where id = m;
  perform rsvp_log(mt, 'rescheduled', jsonb_build_object('previous_starts_at', mt.starts_at, 'new_starts_at', p_starts_at,
    'previous_venue', mt.venue, 'previous_address', mt.address, 'was_started', clock_timestamp() >= mt.starts_at,
    'reset_responses', snap, 'fact_marks_present', marks, 'marks_snapshot_id', sid));
end $$;

-- Вернуть отметки и счёт из снимка (ошибочный перенос). Только пока на матче нет новых отметок и счёта; снимок помечается использованным.
-- Баллы пересчитываются по дате матча, которая сейчас стоит у матча (перенесённой).
create or replace function match_rsvp_restore_marks(p_snapshot uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s match_mark_snapshots; mt matches; el jsonb;
begin
  select * into s from match_mark_snapshots where id = p_snapshot;
  mt := rsvp_lock_match(s.match_id);   -- нет снимка: s.match_id is null, ошибка forbidden (снимок и матч неразличимы для чужих)
  if s.restored_at is not null then raise exception 'snapshot already restored' using errcode = '55000'; end if;
  if mt.lifecycle_status <> 'published' then raise exception 'match is not published' using errcode = '55000'; end if;
  if mt.goals_for is not null or mt.goals_against is not null or mt.technical
     or exists (select 1 from match_players where match_id = mt.id and (played or goals <> 0 or best)) then
    raise exception 'match already has marks' using errcode = '55000';
  end if;
  for el in select * from jsonb_array_elements(s.players) loop
    insert into match_players (match_id, player_id, played, goals, best)
      values (mt.id, (el->>'player_id')::uuid, (el->>'played')::boolean, (el->>'goals')::int, coalesce((el->>'best')::boolean, false))
      on conflict (match_id, player_id) do update set played = excluded.played, goals = excluded.goals, best = excluded.best;
  end loop;
  update matches set goals_for = s.goals_for, goals_against = s.goals_against, technical = s.technical where id = mt.id;
  update match_mark_snapshots set restored_at = clock_timestamp(), restored_by = current_user_id() where id = s.id;
  perform rsvp_log(mt, 'marks_restored', jsonb_build_object('snapshot_id', s.id));
end $$;
revoke execute on function match_rsvp_restore_marks(uuid) from public, anon;
grant execute on function match_rsvp_restore_marks(uuid) to authenticated;

-- Черновик только для идущего события
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
  if p_tournament is not null and exists (select 1 from tournaments where id = p_tournament and status <> 'active') then
    raise exception 'event is finished' using errcode = '55000';
  end if;
  insert into matches (club_id, played_on, team, opponent, kind, tournament_id, lifecycle_status, starts_at, venue, address, notes, created_by)
    values (p_club, tbilisi_day(p_starts_at), trim(p_team), nullif(trim(p_opponent), ''), p_kind, p_tournament, 'draft', p_starts_at,
            nullif(trim(p_venue), ''), nullif(trim(p_address), ''), nullif(trim(p_notes), ''), current_user_id())
    returning * into mt;
  perform rsvp_log(mt, 'created', jsonb_build_object('kind', p_kind, 'team', mt.team, 'starts_at', p_starts_at));
  return mt.id;
end $$;
