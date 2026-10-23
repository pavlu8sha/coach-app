-- Роли тренеров, шаг 2 (docs/COACH_ROLE_PLAN.md): матч, состав, счёт и голы вносит тренер группы.
-- Тренер может и добавить матч своей группы, и заполнить результат у существующего. Пишет только функция:
-- прямой записи в matches/match_players у тренера нет (политики *_admin_write), так и остаётся.
-- Баллы за матч пересчитываются функцией (правила match_played, match_win, match_draw из импорта + новое match_goal).

-- Новое правило: балл за каждый гол. Число правит клуб (rules.points). На уже созданное правило не влияет.
insert into rules (club_id, code, points, explanation, active_from)
  select id, 'match_goal', 1, 'Гол в матче', date '2026-01-01' from clubs
  on conflict (club_id, code, version) do nothing;

-- Действующее правило клуба на дату (последняя версия)
create or replace function rule_for(c uuid, k text, d date) returns rules
language sql stable security definer set search_path = public as $$
  select * from rules where club_id = c and code = k and active_from <= d and (active_to is null or active_to >= d)
  order by version desc limit 1
$$;

-- Матч группы. m = null — создать новый (команда = название группы, как в импорте и в приложении), иначе — править свой.
-- Счёт: оба числа или ни одного (матч ещё не сыгран). roster: [{"player_id": "...", "played": true, "goals": 2}, ...].
-- Играть могут игроки группы и участники матча из match_fees (их ведёт администратор).
create or replace function save_match(m uuid, g uuid, d date, opp text, gf int, ga int, roster jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare grp groups; mt matches; el jsonb; pid uuid; v_played boolean; v_goals int; r rules; v_code text; total int := 0;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into grp from groups where id = g;
  if grp.id is null then raise exception 'group not found'; end if;
  if not (is_admin() or is_coach_of_group(g)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if (gf is null) <> (ga is null) then raise exception 'score incomplete'; end if;
  if gf < 0 or ga < 0 then raise exception 'invalid score'; end if;
  if gf is not null and d > tbilisi_day(now()) then raise exception 'result for future match'; end if;
  if jsonb_typeof(roster) <> 'array' then raise exception 'roster must be an array'; end if;

  if m is null then
    insert into matches (club_id, played_on, team, opponent, goals_for, goals_against)
      values (grp.club_id, d, grp.name, nullif(trim(opp), ''), gf, ga) returning * into mt;
  else
    select * into mt from matches where id = m;
    if mt.id is null then raise exception 'match not found'; end if;
    if mt.club_id <> grp.club_id or mt.team <> grp.name then raise exception 'match is not of this group' using errcode = '42501'; end if;
    update matches set played_on = d, opponent = nullif(trim(opp), ''), goals_for = gf, goals_against = ga where id = m returning * into mt;
  end if;

  for el in select * from jsonb_array_elements(roster) loop
    pid := (el->>'player_id')::uuid;
    v_played := coalesce((el->>'played')::boolean, false);
    v_goals := coalesce((el->>'goals')::int, 0);
    if v_goals < 0 then raise exception 'invalid goals'; end if;
    if v_goals > 0 and not v_played then raise exception 'goals without playing'; end if;
    if not (exists (select 1 from players where id = pid and group_id = g)
         or exists (select 1 from match_fees where match_id = mt.id and player_id = pid)) then
      raise exception 'player not in group';
    end if;
    total := total + v_goals;

    insert into match_players (match_id, player_id, played, goals) values (mt.id, pid, v_played, v_goals)
      on conflict (match_id, player_id) do update set played = excluded.played, goals = excluded.goals;

    -- пересчёт автобаллов этого игрока за этот матч
    delete from point_events where player_id = pid and source_type = 'match' and source_id = mt.id
      and rule_id in (select id from rules where club_id = grp.club_id and code in ('match_played', 'match_win', 'match_draw', 'match_goal'));
    if v_played then
      r := rule_for(grp.club_id, 'match_played', d);
      if r.id is null then raise exception 'rule match_played not found'; end if;
      if r.points <> 0 then
        insert into point_events (player_id, rule_id, points, source_type, source_id, occurred_on, explanation)
          values (pid, r.id, r.points, 'match', mt.id, d, r.explanation);
      end if;
      if gf is not null then
        v_code := case when gf > ga then 'match_win' when gf = ga then 'match_draw' end;
        if v_code is not null then
          r := rule_for(grp.club_id, v_code, d);
          if r.id is null then raise exception 'rule % not found', v_code; end if;
          if r.points <> 0 then
            insert into point_events (player_id, rule_id, points, source_type, source_id, occurred_on, explanation)
              values (pid, r.id, r.points, 'match', mt.id, d, r.explanation);
          end if;
        end if;
      end if;
      if v_goals > 0 then
        r := rule_for(grp.club_id, 'match_goal', d);
        if r.id is null then raise exception 'rule match_goal not found'; end if;
        if r.points <> 0 then
          insert into point_events (player_id, rule_id, points, source_type, source_id, occurred_on, explanation)
            values (pid, r.id, r.points * v_goals, 'match', mt.id, d, r.explanation || ': ' || v_goals);
        end if;
      end if;
    end if;
  end loop;

  if gf is not null and total > gf then raise exception 'goals exceed team score'; end if;
  return mt.id;
end $$;

revoke execute on function rule_for(uuid, text, date), save_match(uuid, uuid, date, text, int, int, jsonb) from public;
grant execute on function save_match(uuid, uuid, date, text, int, int, jsonb) to authenticated;
-- rule_for — служебная, вызывается только изнутри save_match (security definer), приложению недоступна.
