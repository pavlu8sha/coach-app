-- Откат 0226: возвращает прежние тела функций (0134, 0136). Колонка matches.fee и уже созданные match_fees НЕ удаляются:
-- взносы игроков остаются обычными взносами матча (их ведёт Касса). Колонку можно убрать отдельно после решения владельца:
--   alter table matches drop constraint matches_fee_nonneg; alter table matches drop column fee;
-- Применять только по слову Павла.

begin;

drop function if exists match_rsvp_create_draft(uuid, text, text, text, timestamptz, text, text, text, uuid, numeric);
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
revoke execute on function match_rsvp_create_draft(uuid, text, text, text, timestamptz, text, text, text, uuid) from public, anon;
grant execute on function match_rsvp_create_draft(uuid, text, text, text, timestamptz, text, text, text, uuid) to authenticated;
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
drop function if exists match_rsvp_my_matches();
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
revoke execute on function match_rsvp_my_matches() from public, anon;
grant execute on function match_rsvp_my_matches() to authenticated;

drop function if exists rsvp_fee_resync(uuid, numeric, numeric);
drop function if exists rsvp_fee_drop(uuid, uuid[]);
drop function if exists rsvp_fee_assign(uuid, uuid[]);
drop function if exists rsvp_fee_allowed(text, uuid);
commit;
