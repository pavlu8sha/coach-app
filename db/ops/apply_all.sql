-- Миграции 0055–0056 одной транзакцией. Сгенерировано scripts/make-apply-bundle.sh 0055.
-- Перед запуском выполните db/ops/preflight.sql: все номера от 0055 должны быть applied = false. После: db/ops/postcheck.sql.
begin;

-- ===== 0055_match_team_base_name.sql =====
-- 0055: команда нового матча записывается без суффикса группы (U10-A → U10), как в играх (решение владельца 2026-10-26).
-- Заодно тренер может править матч любой команды клуба (как решено в 0042: тренеры ведут матчи всех команд): раньше проверка требовала совпадения команды с его группой («Этот матч принадлежит другой группе»).
-- Тренер, как и администратор, может включить в состав любого игрока клуба (не только своей группы): игроков всех групп он и так видит (0042).
-- Остальное в save_match без изменений (см. 0042).
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
  perform apply_match_points(mt.id);
  return mt.id;
end $$;

-- ===== 0056_coach_ind_marks.sql =====
-- Индивидуальные и вратарские занятия: тренер отмечает посещение (как в старом приложении), не видя денег.
-- До этого ind_set_attended и таблицы занятий были доступны только администратору (0034), поэтому у тренера вкладка индивидуальных в «Занятиях» отвечала «forbidden».
-- ind_roster_list отдаёт тренеру только время, тему, тип, имена записавшихся и отметку посещения: без сумм и оплаты.
-- Отметка посещения доступна администратору и любому тренеру; тренер не может отметить занятие, которое ещё не началось (по Тбилиси), администратор — может.
create or replace function ind_roster_list(d_from date, d_to date)
returns table (session_id uuid, starts_at timestamp, topic text, goalkeepers boolean, player_id uuid, full_name text, attended boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if d_from is null or d_to is null or d_to < d_from then raise exception 'bad period' using errcode = '22023'; end if;
  if d_to - d_from > 120 then raise exception 'period too large' using errcode = '22023'; end if;
  return query
  select s.id, s.starts_at, s.topic, s.goalkeepers, b.player_id, p.full_name, b.attended
  from individual_sessions s
  left join individual_bookings b on b.session_id = s.id
  left join players p on p.id = b.player_id
  where s.starts_at >= d_from::timestamp and s.starts_at < (d_to + 1)::timestamp
  order by s.starts_at desc, p.full_name;
end $$;
revoke execute on function ind_roster_list(date, date) from public, anon;
grant execute on function ind_roster_list(date, date) to authenticated;

create or replace function ind_set_attended(s uuid, p uuid, was boolean) returns void
language plpgsql security definer set search_path = public as $$
declare st timestamp;
begin
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select starts_at into st from individual_sessions where id = s;
  if st is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if not is_admin() and st > (now() at time zone 'Asia/Tbilisi') then raise exception 'date in the future' using errcode = '22023'; end if;
  update individual_bookings set attended = was where session_id = s and player_id = p;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
end $$;

commit;
