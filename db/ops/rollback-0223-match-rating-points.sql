-- Откат 0223: функции возвращаются к телам до 0223 (0122, 0155, 0192, 0136, 0186), снимаются триггеры и проверки оценки.
-- Колонка match_players.performance_rating НЕ удаляется (в ней могут быть оценки тренеров); удалить её можно отдельно, когда оценки не нужны.
-- Выполнять вместе с откатом 0224 и только пока баллы по модели оценки не начислялись, иначе ledger останется с новыми строками.
begin;
drop trigger if exists match_rating_players_check on match_players;
drop trigger if exists match_rating_matches_check on matches;
drop function if exists match_rating_trg_players();
drop function if exists match_rating_trg_matches();
drop function if exists match_rating_check(uuid);
drop trigger if exists match_players_normalize_biu on match_players;
drop function if exists match_players_normalize();
alter table match_players drop constraint if exists match_players_rating_played;
alter table match_players drop constraint if exists match_players_rating_range;
drop trigger points_match_players_sync on match_players;
create constraint trigger points_match_players_sync after insert or update of played, goals, best, match_id or delete on match_players
  deferrable initially deferred for each row execute function points_trg_match_players();
create or replace function match_revisions_log_player() returns trigger
language plpgsql security definer set search_path = public as $$
declare b jsonb; a jsonb;
begin
  if tg_op = 'INSERT' then
    insert into match_revisions (match_id, entity, player_id, action, after, actor_id)
      values (new.match_id, 'player', new.player_id, 'insert',
              jsonb_build_object('played', new.played, 'goals', new.goals, 'best', new.best), current_user_id());
  elsif tg_op = 'UPDATE' then
    b := jsonb_build_object('played', old.played, 'goals', old.goals, 'best', old.best);
    a := jsonb_build_object('played', new.played, 'goals', new.goals, 'best', new.best);
    if a <> b then
      insert into match_revisions (match_id, entity, player_id, action, before, after, actor_id)
        values (new.match_id, 'player', new.player_id, 'update', b, a, current_user_id());
    end if;
  else
    insert into match_revisions (match_id, entity, player_id, action, before, actor_id)
      values (old.match_id, 'player', old.player_id, 'delete',
              jsonb_build_object('played', old.played, 'goals', old.goals, 'best', old.best), current_user_id());
  end if;
  return null;
end $$;
revoke execute on function match_revisions_log_match(), match_revisions_log_player() from public, anon, authenticated;
create or replace function points_reconcile_match(mid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s matches; club uuid; rv points_rule_versions; mp record; exp jsonb := '[]'::jsonb;
        base int; gl int; bst int; total int; cap int; res text;
begin
  select * into s from matches where id = mid;
  if s.id is null then
    select l.club_id into club from points_ledger l where l.source_type = 'match' and l.source_id = mid limit 1;
    if club is not null then perform points_ledger_apply(club, 'match', mid, '[]'::jsonb, 'source_deleted'); end if;
    return;
  end if;
  club := s.club_id;
  rv := points_rules_for(club, s.played_on);
  if rv.id is not null and coalesce((rv.params #>> '{enabled,match}')::boolean, false)
     and s.goals_for is not null and s.goals_against is not null then
    cap := (rv.params #>> '{match,cap}')::int;
    res := case when s.goals_for > s.goals_against then 'win' when s.goals_for = s.goals_against then 'draw' else 'loss' end;
    for mp in select * from match_players where match_id = mid and played loop
      if s.technical then
        base := (rv.params #>> '{match,technical}')::int; gl := 0; bst := 0;
      else
        base := case res when 'win' then (rv.params #>> '{match,win}')::int
                         when 'draw' then (rv.params #>> '{match,draw}')::int
                         else (rv.params #>> '{match,played}')::int end;
        gl := mp.goals * (rv.params #>> '{match,goal}')::int;
        bst := case when mp.best then (rv.params #>> '{match,best}')::int else 0 end;
      end if;
      total := least(base + gl + bst, cap);
      if total > 0 then
        exp := exp || jsonb_build_array(jsonb_build_object('player_id', mp.player_id, 'group_id', points_group_at(mp.player_id, s.played_on),
                 'event_date', s.played_on, 'reason_code', 'match', 'points', total,
                 'components', jsonb_build_object('result', res, 'technical', s.technical, 'base', base, 'goals', gl, 'best', bst,
                                                  'before_cap', base + gl + bst, 'cap', cap),
                 'rule_version_id', rv.id));
      end if;
    end loop;
  end if;
  perform points_ledger_apply(club, 'match', mid, exp, 'match_changed');
end $$;
revoke execute on function points_reconcile_match(uuid) from public, anon, authenticated;
create or replace function save_match(m uuid, g uuid, d date, opp text, gf int, ga int, roster jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare grp groups; mt matches; el jsonb; pid uuid; v_played boolean; v_goals int; v_best boolean; bests int := 0;
        club uuid; adm boolean := is_admin(); ev_kind text; gfee numeric;
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
    insert into match_players (match_id, player_id, played, goals, best) values (mt.id, pid, v_played, v_goals, v_best)
      on conflict (match_id, player_id) do update set played = excluded.played, goals = excluded.goals, best = excluded.best;
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
create or replace function remove_match_player(m uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from matches where id = m) then raise exception 'match not found'; end if;
  if not exists (select 1 from match_players where match_id = m and player_id = p) then raise exception 'player not in match'; end if;
  -- сначала снимаем отметку (баллы пересчитываются триггерами), затем удаляем строку
  update match_players set played = false, goals = 0, best = false where match_id = m and player_id = p;
  delete from match_players where match_id = m and player_id = p;
end $$;
revoke execute on function remove_match_player(uuid, uuid) from public, anon;
grant execute on function remove_match_player(uuid, uuid) to authenticated;
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
create or replace function notify_points_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare child text; txt text;
begin
  if new.status <> 'active' or new.supersedes_id is not null or new.points <= 0 then return null; end if;
  if new.source_type not in ('manual', 'match') then return null; end if;
  if new.event_date < tbilisi_day(now()) - 7 then return null; end if;
  if exists (select 1 from points_ledger o
              where o.player_id = new.player_id and o.source_type = new.source_type and o.source_id = new.source_id and o.id <> new.id) then
    return null;
  end if;
  select full_name into child from players where id = new.player_id;
  if new.source_type = 'manual' then
    txt := coalesce(nullif(new.components ->> 'note', ''), 'баллы от тренера');
  else
    txt := 'матч ' || to_char(new.event_date, 'DD.MM')
        || case new.components ->> 'result' when 'win' then ', победа' when 'draw' then ', ничья' else '' end;
  end if;
  perform enqueue_to_guardians(new.player_id, 'bonus', coalesce(child, 'Ребёнок') || ': +' || new.points || ' — ' || txt);
  return null;
end $$;
revoke execute on function notify_points_ledger() from public, anon, authenticated;
create or replace function points_consistency_run(fix boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare floor_day date; r record; before_id bigint; n int; drift jsonb := '[]'::jsonb; total int := 0; checked int := 0; exc jsonb := '[]'::jsonb;
        club uuid;
begin
  for r in
    select 'group_session' as st, id from sessions where kind = 'training'
    union select 'group_session', source_id from points_ledger where source_type = 'group_session'
    union select 'individual', id from individual_sessions
    union select 'individual', source_id from points_ledger where source_type in ('individual', 'goalkeeper')
    union select 'extra', id from extra_sessions
    union select 'extra', source_id from points_ledger where source_type = 'extra'
    union select 'match', id from matches
    union select 'match', source_id from points_ledger where source_type = 'match'
    union select 'series', id from players
    union select 'series', source_id from points_ledger where source_type = 'series_bonus'
    -- 0186: ручные баллы раньше даты старта (тестовый период) закрываются
    union select 'manual', source_id from points_ledger where source_type = 'manual' and status = 'active' and event_date < points_start()
  loop
    checked := checked + 1;
    select coalesce(max(id), 0) into before_id from points_ledger_audit;
    begin
      case r.st
        when 'group_session' then perform points_reconcile_group_session(r.id);
        when 'individual' then perform points_reconcile_individual(r.id);
        when 'extra' then perform points_reconcile_extra(r.id);
        when 'match' then perform points_reconcile_match(r.id);
        when 'manual' then
          select l.club_id into club from points_ledger l where l.source_type = 'manual' and l.source_id = r.id limit 1;
          perform points_ledger_apply(club, 'manual', r.id, '[]'::jsonb, 'points_start');
        else perform points_reconcile_series(r.id);
      end case;
      select count(*) into n from points_ledger_audit where id > before_id;
      if not fix then raise exception 'points_consistency_dry_run' using errcode = 'P0001'; end if;
    exception when others then
      if sqlerrm <> 'points_consistency_dry_run' then raise; end if;
    end;
    if n > 0 then
      total := total + n;
      if jsonb_array_length(drift) < 100 then
        drift := drift || jsonb_build_array(jsonb_build_object('source_type', r.st, 'source_id', r.id, 'changes', n));
      end if;
    end if;
  end loop;

  -- Исключения: начисление не создано или неполное; события раньше начала подсчёта не показываем
  select greatest(coalesce(points_start(), date '-infinity'), coalesce(min(v.effective_from), date 'infinity')) into floor_day from points_rule_versions v;
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'match_without_score', 'source_id', m.id, 'event_date', m.played_on)), '[]'::jsonb) into exc
    from matches m
   where m.played_on >= floor_day and (m.goals_for is null or m.goals_against is null) and exists (select 1 from match_players mp where mp.match_id = m.id and mp.played);
  exc := exc || coalesce((select jsonb_agg(jsonb_build_object('kind', 'ledger_without_group', 'source_id', l.id, 'event_date', l.event_date, 'player_id', l.player_id))
                            from points_ledger l where l.status = 'active' and l.group_id is null and l.source_type <> 'series_bonus' and l.event_date >= floor_day), '[]'::jsonb);

  if fix and total > 0 then
    insert into audit_log (actor_id, action, entity, entity_id, before, after)
      values (current_user_id(), 'points_consistency_fix', 'points_ledger', null, null, jsonb_build_object('changes', total, 'checked', checked));
  end if;
  return jsonb_build_object('fix', fix, 'checked', checked, 'changes', total, 'drift', drift, 'exceptions', exc);
end $$;
revoke execute on function points_consistency_run(boolean) from public, anon, authenticated;
commit;
