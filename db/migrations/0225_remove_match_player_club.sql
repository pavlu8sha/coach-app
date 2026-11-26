-- 0225: remove_match_player, save_match, set_match_technical и delete_match не дают менять матч чужого клуба.
-- Тело 0223 (последнее определение: grep -lEi "function +(public\.)?remove_match_player *\(" db/migrations/*.sql даёт 0192 и 0223),
-- единственное изменение: проверка клуба матча после проверки роли и существования матча.
-- Клуб пользователя: club_event_current_club() (users.club_id, иначе единственный клуб, иначе NULL).
-- Тренер с неопределимым клубом получает отказ; администратор с неопределимым клубом работает как раньше.
-- save_match: тело 0223 (последнее определение), добавлена та же проверка клуба сразу после проверки роли.
-- search_path = public, pg_temp (как is_admin() в 0222): временная схема стоит последней, подмена pg_temp.matches и других таблиц не работает (ревью #830, P1).
-- set_match_technical: тело 0122, delete_match: тело 0027 (последние определения), та же проверка клуба.
-- Условия: docs/REMOVE_MATCH_PLAYER_CLUB_ACCEPTANCE.md. Откат: db/ops/rollback-0225-remove-match-player-club.sql.
create or replace function remove_match_player(m uuid, p uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare was_best boolean; mclub uuid; uclub uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into mclub from matches where id = m;
  if not found then raise exception 'match not found'; end if;
  uclub := club_event_current_club();
  if uclub is distinct from mclub and (uclub is not null or not is_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from match_players where match_id = m and player_id = p) then raise exception 'player not in match'; end if;
  select best into was_best from match_players where match_id = m and player_id = p;
  if coalesce(was_best, false) then perform set_config('app.match_best_removed', m::text, true); end if;
  update match_players set played = false, goals = 0, best = false, performance_rating = null where match_id = m and player_id = p;
  delete from match_players where match_id = m and player_id = p;
end $$;
revoke execute on function remove_match_player(uuid, uuid) from public, anon;
grant execute on function remove_match_player(uuid, uuid) to authenticated;

-- save_match (тело 0223 + проверка клуба)
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

-- set_match_technical (тело 0122 + проверка клуба; «match not found» с прежним кодом P0002)
create or replace function set_match_technical(m uuid, tech boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare mclub uuid; uclub uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if tech is null then raise exception 'technical flag required' using errcode = '22023'; end if;
  select club_id into mclub from matches where id = m;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  uclub := club_event_current_club();
  if uclub is distinct from mclub and (uclub is not null or not is_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update matches set technical = tech where id = m;
end $$;
revoke execute on function set_match_technical(uuid, boolean) from public, anon;
grant execute on function set_match_technical(uuid, boolean) to authenticated;

-- delete_match (тело 0027 + проверка клуба; только администратор)
create or replace function delete_match(m uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare mt matches; uclub uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into mt from matches where id = m;
  if mt.id is null then raise exception 'match not found'; end if;
  uclub := club_event_current_club();
  if uclub is distinct from mt.club_id and (uclub is not null or not is_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if exists (select 1 from match_fees where match_id = m) then raise exception 'match has fees'; end if;
  delete from point_events where source_type = 'match' and source_id = m;
  delete from matches where id = m;
  insert into audit_log (actor_id, action, entity, entity_id, before) values (current_user_id(), 'delete_match', 'matches', m, to_jsonb(mt));
end $$;
revoke execute on function delete_match(uuid) from public, anon;
grant execute on function delete_match(uuid) to authenticated;
