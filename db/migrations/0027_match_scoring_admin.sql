-- Баллы за матч по новой схеме (решение Павла 2026-10-23) и правка матчей администратором.
--  * Победа: 2 балла каждому, кто играл; лучшему игроку матча — 3 (вместо 2).
--  * Поражение или ничья: 1 балл каждому, кто играл. Гол по-прежнему +1 (правило match_goal).
--  * Баллы за участие и за победу вместе больше не даются. Баллы за результат начисляются, когда внесён счёт.
-- Администратор может править любой матч и добавлять в состав любого игрока клуба; удалять матч; пересчитывать баллы.
-- Новые правила — версией 2 (старая версия остаётся у ранее начисленных баллов); при выборе действует последняя версия.

alter table match_players add column best boolean not null default false;
create unique index match_players_one_best on match_players (match_id) where best;

insert into rules (club_id, code, version, points, explanation, active_from)
  select id, 'match_best', 1, 3, 'Лучший игрок матча', date '2026-01-01' from clubs on conflict (club_id, code, version) do nothing;
insert into rules (club_id, code, version, points, explanation, active_from)
  select id, 'match_played', 2, 1, 'Участие в матче', date '2026-01-01' from clubs on conflict (club_id, code, version) do nothing;
insert into rules (club_id, code, version, points, explanation, active_from)
  select id, 'match_win', 2, 2, 'Победа команды в матче', date '2026-01-01' from clubs on conflict (club_id, code, version) do nothing;

-- Пересчёт автоначислений матча для всех игроков его состава (участие, победа, лучший, голы).
create or replace function apply_match_points(mid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches; mp record; r rules; known boolean; v_code text;
begin
  select * into mt from matches where id = mid;
  if mt.id is null then raise exception 'match not found'; end if;
  known := mt.goals_for is not null and mt.goals_against is not null;
  delete from point_events
   where source_type = 'match' and source_id = mid
     and player_id in (select player_id from match_players where match_id = mid)
     and rule_id in (select id from rules where club_id = mt.club_id and code in ('match_played', 'match_win', 'match_draw', 'match_goal', 'match_best'));
  for mp in select * from match_players where match_id = mid and played loop
    if known then
      v_code := case when mt.goals_for > mt.goals_against then (case when mp.best then 'match_best' else 'match_win' end) else 'match_played' end;
      r := rule_for(mt.club_id, v_code, mt.played_on);
      if r.id is null then raise exception 'rule % not found', v_code; end if;
      if r.points <> 0 then
        insert into point_events (player_id, rule_id, points, source_type, source_id, occurred_on, explanation)
          values (mp.player_id, r.id, r.points, 'match', mid, mt.played_on, r.explanation);
      end if;
    end if;
    if mp.goals > 0 then
      r := rule_for(mt.club_id, 'match_goal', mt.played_on);
      if r.id is null then raise exception 'rule match_goal not found'; end if;
      if r.points <> 0 then
        insert into point_events (player_id, rule_id, points, source_type, source_id, occurred_on, explanation)
          values (mp.player_id, r.id, r.points * mp.goals, 'match', mid, mt.played_on, r.explanation || ': ' || mp.goals);
      end if;
    end if;
  end loop;
end $$;

-- Матч группы: создать (m = null) или править. Тренер — только матчи своей группы и игроки группы/участники из match_fees.
-- Администратор — любой матч (группа g для существующего матча не нужна) и любой игрок клуба.
-- Состав: [{"player_id": "...", "played": true, "goals": 2, "best": true}, ...]; лучший игрок один и обязательно играл.
create or replace function save_match(m uuid, g uuid, d date, opp text, gf int, ga int, roster jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare grp groups; mt matches; el jsonb; pid uuid; v_played boolean; v_goals int; v_best boolean; bests int := 0;
        club uuid; adm boolean := is_admin();
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
  if not adm and not (g is not null and is_coach_of_group(g)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if (gf is null) <> (ga is null) then raise exception 'score incomplete'; end if;
  if gf < 0 or ga < 0 then raise exception 'invalid score'; end if;
  if gf is not null and d > tbilisi_day(now()) then raise exception 'result for future match'; end if;
  if jsonb_typeof(roster) <> 'array' then raise exception 'roster must be an array'; end if;

  if m is null then
    insert into matches (club_id, played_on, team, opponent, goals_for, goals_against)
      values (club, d, grp.name, nullif(trim(opp), ''), gf, ga) returning * into mt;
  else
    if not adm and (mt.club_id <> grp.club_id or mt.team <> grp.name) then raise exception 'match is not of this group' using errcode = '42501'; end if;
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
    if adm then
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
  perform apply_match_points(mt.id);
  return mt.id;
end $$;

-- Удалить матч (администратор): вместе с составом и автоначислениями. Матч со взносами не удаляется.
create or replace function delete_match(m uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into mt from matches where id = m;
  if mt.id is null then raise exception 'match not found'; end if;
  if exists (select 1 from match_fees where match_id = m) then raise exception 'match has fees'; end if;
  delete from point_events where source_type = 'match' and source_id = m;
  delete from matches where id = m;
  insert into audit_log (actor_id, action, entity, entity_id, before) values (current_user_id(), 'delete_match', 'matches', m, to_jsonb(mt));
end $$;

-- Пересчитать автоначисления матча (или всех матчей с составом) по действующим правилам. Администратор. Возвращает число матчей.
create or replace function recalc_match_points(m uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare x uuid; n int := 0;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  for x in select id from matches where (m is null or id = m) and exists (select 1 from match_players p where p.match_id = matches.id) loop
    perform apply_match_points(x);
    n := n + 1;
  end loop;
  insert into audit_log (actor_id, action, entity, entity_id, after) values (current_user_id(), 'recalc_match_points', 'matches', m, jsonb_build_object('matches', n));
  return n;
end $$;

revoke execute on function apply_match_points(uuid), delete_match(uuid), recalc_match_points(uuid) from public;
grant execute on function delete_match(uuid), recalc_match_points(uuid) to authenticated;
