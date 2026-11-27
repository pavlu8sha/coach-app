-- 0227: единый экран матча (PR 2). Права тренера и проверка статуса.
-- 1) match_rsvp_cancel и match_rsvp_reschedule: только администратор (тренер клуба получает 42501 'only admin can cancel or reschedule').
-- 2) match_rsvp_update: смена starts_at у опубликованного матча только у администратора.
-- 3) save_match (и через него save_match_tech): отказ у матча-черновика и отменённого матча (55000).
-- Тела: match_rsvp_cancel и match_rsvp_update из 0226, match_rsvp_reschedule из 0136 (search_path с pg_temp), save_match из 0225.
-- Условия: docs/MATCH_UNIFIED_SCREEN_PR2_ACCEPTANCE.md. Откат: db/ops/rollback-0227-match-unified-pr2.sql.

create or replace function match_rsvp_cancel(m uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare mt matches;
begin
  mt := rsvp_lock_match(m);
  -- 0227: отмену матча выполняет администратор (тренер клуба отменить не может)
  if not is_admin() then raise exception 'only admin can cancel or reschedule' using errcode = '42501'; end if;
  if mt.lifecycle_status = 'draft' then raise exception 'draft is deleted, not cancelled' using errcode = '55000'; end if;
  if mt.lifecycle_status <> 'published' then raise exception 'match is already cancelled' using errcode = '55000'; end if;
  update matches set lifecycle_status = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = current_user_id(),
    cancel_reason = nullif(trim(p_reason), '') where id = m;
  -- отменённый матч не должен висеть долгом: взносы без оплат снимаются, с оплатой остаются
  if mt.fee is not null then perform rsvp_fee_drop(m); end if;
  perform rsvp_log(mt, 'cancelled', jsonb_build_object('reason', nullif(trim(p_reason), ''), 'was_started', clock_timestamp() >= mt.starts_at));
end $$;

revoke execute on function match_rsvp_cancel(uuid, text) from public, anon;
grant execute on function match_rsvp_cancel(uuid, text) to authenticated;

create or replace function match_rsvp_reschedule(m uuid, p_starts_at timestamptz, p_venue text default null, p_address text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare mt matches; snap jsonb; marks boolean; sid uuid;
begin
  mt := rsvp_lock_match(m);
  -- 0227: перенос матча выполняет администратор (тренер клуба перенести не может)
  if not is_admin() then raise exception 'only admin can cancel or reschedule' using errcode = '42501'; end if;
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

revoke execute on function match_rsvp_reschedule(uuid, timestamptz, text, text) from public, anon;
grant execute on function match_rsvp_reschedule(uuid, timestamptz, text, text) to authenticated;

create or replace function match_rsvp_update(m uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare mt matches; k text; nw matches; b_ jsonb := '{}'::jsonb; a_ jsonb := '{}'::jsonb; ns timestamptz; fee_given boolean := false;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'bad payload' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('opponent', 'venue', 'address', 'notes', 'starts_at', 'kind', 'team', 'tournament_id', 'fee') then
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
  if p ? 'fee' then
    fee_given := true;
    nw.fee := nullif(p->>'fee', '')::numeric;
    if nw.fee is not null and nw.fee < 0 then raise exception 'bad fee' using errcode = '22023'; end if;
  end if;
  if nw.fee is not null and not rsvp_fee_allowed(nw.kind, nw.tournament_id) then
    -- событие поменяли на чемпионат/фестиваль: взнос матча сбрасывается; явная сумма у такого матча запрещена
    if fee_given then raise exception 'fee not allowed' using errcode = '22023'; end if;
    nw.fee := null;
  end if;
  if p ? 'starts_at' then
    ns := (p->>'starts_at')::timestamptz;
    if ns is null then raise exception 'start time required' using errcode = '22023'; end if;
    -- 0227: время начала опубликованного матча меняет только администратор (у черновика время правит тренер, как раньше)
    if mt.lifecycle_status = 'published' and ns is distinct from mt.starts_at and not is_admin() then
      raise exception 'only admin can cancel or reschedule' using errcode = '42501';
    end if;
    if mt.lifecycle_status = 'published' then
      if ns <= clock_timestamp() then raise exception 'start in the past' using errcode = '22023'; end if;
      if tbilisi_day(ns) <> tbilisi_day(mt.starts_at) then raise exception 'date change requires reschedule' using errcode = '55000'; end if;
    end if;
    nw.starts_at := ns;
  end if;
  if (nw.opponent, nw.venue, nw.address, nw.notes, nw.kind, nw.team, nw.tournament_id, nw.starts_at, nw.fee)
     is not distinct from (mt.opponent, mt.venue, mt.address, mt.notes, mt.kind, mt.team, mt.tournament_id, mt.starts_at, mt.fee) then
    return;
  end if;
  update matches set opponent = nw.opponent, venue = nw.venue, address = nw.address, notes = nw.notes, kind = nw.kind, team = nw.team,
    tournament_id = nw.tournament_id, starts_at = nw.starts_at, played_on = tbilisi_day(nw.starts_at), fee = nw.fee where id = m;
  if nw.fee is distinct from mt.fee and mt.lifecycle_status = 'published' then
    perform rsvp_fee_resync(m, mt.fee, nw.fee);
  elsif nw.fee is null and mt.fee is not null then
    perform rsvp_fee_resync(m, mt.fee, null);
  end if;
  if mt.lifecycle_status = 'published' then
    if nw.opponent is distinct from mt.opponent then b_ := b_ || jsonb_build_object('opponent', mt.opponent); a_ := a_ || jsonb_build_object('opponent', nw.opponent); end if;
    if nw.venue is distinct from mt.venue then b_ := b_ || jsonb_build_object('venue', mt.venue); a_ := a_ || jsonb_build_object('venue', nw.venue); end if;
    if nw.address is distinct from mt.address then b_ := b_ || jsonb_build_object('address', mt.address); a_ := a_ || jsonb_build_object('address', nw.address); end if;
    if nw.notes is distinct from mt.notes then b_ := b_ || jsonb_build_object('notes', mt.notes); a_ := a_ || jsonb_build_object('notes', nw.notes); end if;
    if nw.fee is distinct from mt.fee then b_ := b_ || jsonb_build_object('fee', mt.fee); a_ := a_ || jsonb_build_object('fee', nw.fee); end if;
    if nw.starts_at is distinct from mt.starts_at then
      b_ := b_ || jsonb_build_object('starts_at', mt.starts_at); a_ := a_ || jsonb_build_object('starts_at', nw.starts_at);
      -- дедлайн пересчитан от нового времени (matches.rsvp_deadline_at вычисляется сам), окно ответа — тоже
      update match_invitations set answer_until = match_rsvp_answer_until(nw.starts_at) where match_id = m and status = 'invited';
    end if;
    perform rsvp_log(mt, 'details_changed', jsonb_build_object('before', b_, 'after', a_));
  end if;
end $$;

revoke execute on function match_rsvp_update(uuid, jsonb) from public, anon;
grant execute on function match_rsvp_update(uuid, jsonb) to authenticated;

create or replace function save_match(m uuid, g uuid, d date, opp text, gf int, ga int, roster jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare grp groups; mt matches; el jsonb; pid uuid; v_played boolean; v_goals int; v_best boolean; bests int := 0; v_rating int; v_has_rating boolean;
        club uuid; uclub uuid; adm boolean := is_admin(); ev_kind text; gfee numeric;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if g is not null then
    select * into grp from groups where id = g;
    if grp.id is null then raise exception 'group not found'; end if;
    club := grp.club_id;
  end if;
  if m is not null then
    select * into mt from matches where id = m;
    if mt.id is null then raise exception 'match not found'; end if;
    club := mt.club_id;
  elsif g is null then
    raise exception 'group required';
  end if;
  if not adm and not (g is not null and is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  -- 0225: клуб матча (или группы нового матча) должен быть клубом пользователя; администратор с неопределимым клубом работает как раньше
  uclub := club_event_current_club();
  if uclub is distinct from club and (uclub is not null or not adm) then raise exception 'forbidden' using errcode = '42501'; end if;
  -- 0227: строка матча блокируется до проверки статуса: запись результата сериализуется с match_rsvp_cancel/reschedule (они берут ту же блокировку)
  if m is not null then
    select * into mt from matches where id = m for update;
    if mt.id is null then raise exception 'match not found'; end if;
  end if;
  -- 0227: результат не принимается у черновика и отменённого матча с подтверждением (клуб проверен выше)
  if m is not null and mt.lifecycle_status = 'draft' then raise exception 'match is a draft' using errcode = '55000'; end if;
  if m is not null and mt.lifecycle_status = 'cancelled' then raise exception 'match is cancelled' using errcode = '55000'; end if;
  if (gf is null) <> (ga is null) then raise exception 'score incomplete'; end if;
  if gf < 0 or ga < 0 then raise exception 'invalid score'; end if;
  if gf is not null and d > tbilisi_day(now()) then raise exception 'result for future match'; end if;
  if jsonb_typeof(roster) <> 'array' then raise exception 'roster must be an array'; end if;

  if m is null then
    insert into matches (club_id, played_on, team, opponent, goals_for, goals_against)
      values (club, d, regexp_replace(grp.name, '-[A-Z]$', ''), nullif(trim(opp), ''), gf, ga) returning * into mt;
  else
    if not adm and mt.club_id <> grp.club_id then raise exception 'match is not of this group' using errcode = '42501'; end if;
    update matches set played_on = d, opponent = nullif(trim(opp), ''), goals_for = gf, goals_against = ga where id = m returning * into mt;
  end if;

  -- лучший игрок один: прежнего снимаем, если в составе назван новый
  if exists (select 1 from jsonb_array_elements(roster) e where coalesce((e->>'best')::boolean, false)) then
    update match_players set best = false where match_id = mt.id and best;
  end if;

  for el in select * from jsonb_array_elements(roster) loop
    pid := (el->>'player_id')::uuid;
    v_played := coalesce((el->>'played')::boolean, false);
    v_goals := coalesce((el->>'goals')::int, 0);
    v_best := coalesce((el->>'best')::boolean, false);
    -- 0223: оценка тренера 1-5; без ключа performance_rating прежняя оценка строки остаётся (старый клиент её не стирает)
    v_has_rating := el ? 'performance_rating';
    v_rating := nullif(el->>'performance_rating', '')::int;
    if v_rating is not null and v_rating not between 1 and 5 then raise exception 'invalid rating'; end if;
    if v_rating is not null and not v_played then raise exception 'rating without playing'; end if;
    if v_goals < 0 then raise exception 'invalid goals'; end if;
    if v_goals > 0 and not v_played then raise exception 'goals without playing'; end if;
    if v_best and not v_played then raise exception 'best player must have played'; end if;
    if v_best then bests := bests + 1; end if;
    if bests > 1 then raise exception 'only one best player'; end if;
    if adm or is_any_coach() then
      if not exists (select 1 from players where id = pid and club_id = club) then raise exception 'player not in club'; end if;
    elsif not (exists (select 1 from players where id = pid and group_id = g) or exists (select 1 from match_fees where match_id = mt.id and player_id = pid)) then
      raise exception 'player not in group';
    end if;
    insert into match_players (match_id, player_id, played, goals, best, performance_rating) values (mt.id, pid, v_played, v_goals, v_best, v_rating)
      on conflict (match_id, player_id) do update set played = excluded.played, goals = excluded.goals, best = excluded.best,
        performance_rating = case when v_has_rating then excluded.performance_rating else match_players.performance_rating end;
  end loop;

  if gf is not null and (select coalesce(sum(goals), 0) from match_players where match_id = mt.id and played) > gf then
    raise exception 'goals exceed team score';
  end if;
  -- 0155: гость чемпионата или фестиваля (отмечен «Играл», но не заявлен ни в одной команде этого чемпионата) получает разовый взнос за матч.
  -- Взнос события не меняется. Сумма из настройки клуба matches.guestFee. Оплаченные и со скидкой строки не трогаем.
  if mt.tournament_id is not null and mt.kind is distinct from 'friendly' then
    select t.kind into ev_kind from tournaments t where t.id = mt.tournament_id;
    if ev_kind in ('championship', 'festival') then
      gfee := guest_match_fee(mt.club_id);
      for el in select * from jsonb_array_elements(roster) loop
        pid := (el->>'player_id')::uuid;
        if event_player_covered(mt.tournament_id, pid) then continue; end if;
        if coalesce((el->>'played')::boolean, false) then
          insert into match_fees (match_id, player_id, amount) values (mt.id, pid, gfee) on conflict (match_id, player_id) do nothing;
        else
          delete from match_fees f where f.match_id = mt.id and f.player_id = pid and not f.paid and f.amount = gfee
            and not exists (select 1 from match_payments x where x.match_id = mt.id and x.player_id = pid);
        end if;
      end loop;
    end if;
  end if;
  perform apply_match_points(mt.id);
  return mt.id;
end $$;

revoke execute on function save_match(uuid, uuid, date, text, int, int, jsonb) from public, anon;
grant execute on function save_match(uuid, uuid, date, text, int, int, jsonb) to authenticated;
