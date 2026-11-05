-- 0122: баллы за матчи в новом журнале (#18, этап 6).
--  * Баллы получает игрок с отметкой «Играл» в матче со счётом: участие +1 (поражение, ничья), +2 (победа), каждый гол +1, лучший игрок +2,
--    итог за матч не больше match.cap (5). Все значения берутся из версии правил на дату матча. Голы и «лучший» в статистике сохраняются полностью.
--  * Технический результат (matches.technical): баллов нет (match.technical, по умолчанию 0). Признак ставит тренер или администратор: set_match_technical.
--  * Группа начисления = тренировочная группа игрока на дату матча (player_group_history), а не matches.team (это состав соревнования).
--  * Начисление пересчитывается отложенными триггерами на matches и match_players: сохранение матча, правка из SQL Editor и удаление согласуют журнал;
--    повтор ничего не меняет (points_ledger_apply).
--  * match_revisions: журнал исправлений матча (кто, когда, что было и стало). Читают администратор и тренеры; родителям и детям не виден.
--  * Старые point_events, apply_match_points, save_match и points_start не затронуты. До вступления в силу первой версии правил начислений нет.
-- Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

alter table matches add column technical boolean not null default false;

-- Журнал исправлений. match_id без внешнего ключа: история остаётся и после удаления матча.
create table match_revisions (
  id bigint generated always as identity primary key,
  match_id uuid not null,
  entity text not null check (entity in ('match', 'player')),
  player_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  actor_id uuid references users(id),
  at timestamptz not null default now()
);
create index match_revisions_match on match_revisions (match_id, at);

alter table match_revisions enable row level security;
create policy match_revisions_read on match_revisions for select using (is_admin() or is_any_coach());
revoke all on match_revisions from authenticated, anon;
grant select on match_revisions to authenticated;
grant select, insert on match_revisions to service_role;

create or replace function match_revisions_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'match revisions are append-only' using errcode = '42501';
end $$;
create trigger match_revisions_no_change before update or delete on match_revisions
  for each row execute function match_revisions_guard();

create or replace function match_revisions_log_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare b jsonb; a jsonb;
begin
  if tg_op = 'INSERT' then
    insert into match_revisions (match_id, entity, action, after, actor_id)
      values (new.id, 'match', 'insert', jsonb_build_object('played_on', new.played_on, 'opponent', new.opponent,
              'goals_for', new.goals_for, 'goals_against', new.goals_against, 'technical', new.technical), current_user_id());
  elsif tg_op = 'UPDATE' then
    b := jsonb_build_object('played_on', old.played_on, 'opponent', old.opponent, 'goals_for', old.goals_for,
                            'goals_against', old.goals_against, 'technical', old.technical);
    a := jsonb_build_object('played_on', new.played_on, 'opponent', new.opponent, 'goals_for', new.goals_for,
                            'goals_against', new.goals_against, 'technical', new.technical);
    if a <> b then
      insert into match_revisions (match_id, entity, action, before, after, actor_id)
        values (new.id, 'match', 'update', b, a, current_user_id());
    end if;
  else
    insert into match_revisions (match_id, entity, action, before, actor_id)
      values (old.id, 'match', 'delete', jsonb_build_object('played_on', old.played_on, 'opponent', old.opponent,
              'goals_for', old.goals_for, 'goals_against', old.goals_against, 'technical', old.technical), current_user_id());
  end if;
  return null;
end $$;

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

create trigger match_revisions_matches after insert or update or delete on matches
  for each row execute function match_revisions_log_match();
create trigger match_revisions_players after insert or update or delete on match_players
  for each row execute function match_revisions_log_player();

-- Начисление за матч
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

create or replace function points_trg_match_players() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform points_reconcile_match(case when tg_op = 'DELETE' then old.match_id else new.match_id end);
  return null;
end $$;
create or replace function points_trg_matches() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform points_reconcile_match(case when tg_op = 'DELETE' then old.id else new.id end);
  return null;
end $$;
revoke execute on function points_trg_match_players(), points_trg_matches() from public, anon, authenticated;

-- Отложенные триггеры: расчёт идёт один раз по итоговому состоянию матча в конце транзакции (сохранение состава идёт по одному игроку)
create constraint trigger points_matches_sync after insert or update of played_on, goals_for, goals_against, technical or delete on matches
  deferrable initially deferred for each row execute function points_trg_matches();
create constraint trigger points_match_players_sync after insert or update of played, goals, best, match_id or delete on match_players
  deferrable initially deferred for each row execute function points_trg_match_players();

-- Технический результат ставит тренер или администратор
create or replace function set_match_technical(m uuid, tech boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_any_coach()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if tech is null then raise exception 'technical flag required' using errcode = '22023'; end if;
  update matches set technical = tech where id = m;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
end $$;
revoke execute on function set_match_technical(uuid, boolean) from public, anon;
grant execute on function set_match_technical(uuid, boolean) to authenticated;

commit;
