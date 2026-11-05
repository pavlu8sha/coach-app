-- 0123: ручные баллы тренера в новом журнале (#18, этап 7).
--  * Тренер игрока или администратор начисляет +1, +2 или +3 (значения из версии правил) с обязательным комментарием до 200 знаков.
--  * Месячные лимиты на игрока по правилам: +1 до 3 раз, +2 до 2 раз, +3 один раз (итого не больше 10 баллов в месяц). Месяц по дате начисления (Asia/Tbilisi).
--  * Отмена только с причиной; запись не удаляется (в журнале статус cancelled, автор и причина в аудите). Отменённое начисление лимит не расходует.
--  * Повтор запроса с тем же req не создаёт дубль: req служит идентификатором источника. Повторная отмена ничего не меняет.
--  * Лимиты и отмена проверяются под блокировкой «игрок + месяц»: две одновременные заявки не обойдут лимит.
--  * До вступления в силу первой версии правил (2026-12-01) функции начисления отвечают 'points rules not active', points_manual_status возвращает active = false.
--    Старые award_bonus и revoke_bonus не затронуты и работают до запуска.
-- Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

-- Состояние для экрана: действуют ли новые правила и сколько начислений осталось в этом месяце
create or replace function points_manual_status(p uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pl players; day date := tbilisi_day(now()); rv points_rule_versions; mon date; v jsonb; rem jsonb := '{}'::jsonb; k text; used int; lim int; total int; cap int;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into pl from players where id = p;
  if pl.id is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  if not (is_admin() or is_coach_of_player(p)) then raise exception 'forbidden' using errcode = '42501'; end if;
  rv := points_rules_for(pl.club_id, day);
  if rv.id is null or not coalesce((rv.params #>> '{enabled,manual}')::boolean, false) then
    return jsonb_build_object('active', false);
  end if;
  mon := day - (extract(day from day)::int - 1);
  cap := (rv.params #>> '{manual,month_cap}')::int;
  select coalesce(sum(points), 0) into total from points_ledger
    where player_id = p and source_type = 'manual' and status = 'active' and month = mon;
  for v in select * from jsonb_array_elements(rv.params #> '{manual,values}') loop
    k := v #>> '{}';
    lim := coalesce((rv.params #>> array['manual', 'limits', k])::int, 0);
    select count(*) into used from points_ledger
      where player_id = p and source_type = 'manual' and status = 'active' and month = mon and points = k::int;
    rem := rem || jsonb_build_object(k, greatest(lim - used, 0));
  end loop;
  return jsonb_build_object('active', true, 'remaining', rem, 'month_total', total, 'month_cap', cap);
end $$;
revoke execute on function points_manual_status(uuid) from public, anon;
grant execute on function points_manual_status(uuid) to authenticated;

-- Начисление. req — идентификатор заявки от экрана: повтор с тем же req ничего не добавляет.
create or replace function points_manual_award(p uuid, pts int, note text, req uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare pl players; day date := tbilisi_day(now()); rv points_rule_versions; mon date; txt text := trim(coalesce(note, ''));
        lim int; used int; total int; cap int; existing points_ledger; new_id uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into pl from players where id = p;
  if pl.id is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  if not (is_admin() or is_coach_of_player(p)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if req is null then raise exception 'request id required' using errcode = '22023'; end if;
  if txt = '' then raise exception 'note required' using errcode = '22023'; end if;
  if char_length(txt) > 200 then raise exception 'note too long' using errcode = '22023'; end if;

  -- повтор той же заявки: возвращаем прежнюю запись, лимит заново не считаем
  select * into existing from points_ledger
    where source_type = 'manual' and source_id = req and player_id = p and reason_code = 'manual' order by created_at desc limit 1;
  if existing.id is not null then return existing.id; end if;
  if exists (select 1 from points_ledger where source_type = 'manual' and source_id = req) then
    raise exception 'request id already used' using errcode = '22023';
  end if;

  rv := points_rules_for(pl.club_id, day);
  if rv.id is null or not coalesce((rv.params #>> '{enabled,manual}')::boolean, false) then
    raise exception 'points rules not active' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_array_elements(rv.params #> '{manual,values}') x where (x #>> '{}')::int = pts) then
    raise exception 'points value not allowed' using errcode = '22023';
  end if;

  mon := day - (extract(day from day)::int - 1);
  perform pg_advisory_xact_lock(hashtext('points_manual:' || p::text || ':' || mon::text));
  lim := coalesce((rv.params #>> array['manual', 'limits', pts::text])::int, 0);
  select count(*) into used from points_ledger
    where player_id = p and source_type = 'manual' and status = 'active' and month = mon and points = pts;
  if used >= lim then raise exception 'monthly limit reached for this value' using errcode = '22023'; end if;
  cap := (rv.params #>> '{manual,month_cap}')::int;
  select coalesce(sum(points), 0) into total from points_ledger
    where player_id = p and source_type = 'manual' and status = 'active' and month = mon;
  if total + pts > cap then raise exception 'monthly cap reached' using errcode = '22023'; end if;

  perform points_ledger_apply(pl.club_id, 'manual', req, jsonb_build_array(jsonb_build_object(
    'player_id', p, 'group_id', points_group_at(p, day), 'event_date', day, 'reason_code', 'manual', 'points', pts,
    'components', jsonb_build_object('note', txt, 'author_id', current_user_id()), 'rule_version_id', rv.id)), 'manual_award');
  select id into new_id from points_ledger where source_type = 'manual' and source_id = req and status = 'active' and player_id = p;
  return new_id;
end $$;
revoke execute on function points_manual_award(uuid, int, text, uuid) from public, anon;
grant execute on function points_manual_award(uuid, int, text, uuid) to authenticated;

-- Отмена с причиной. Запись остаётся в журнале со статусом cancelled; лимит месяца освобождается.
create or replace function points_manual_cancel(entry uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e points_ledger; txt text := trim(coalesce(reason, ''));
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into e from points_ledger where id = entry and source_type = 'manual';
  if e.id is null then raise exception 'entry not found' using errcode = 'P0002'; end if;
  if not (is_admin() or is_coach_of_player(e.player_id)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if txt = '' then raise exception 'reason required' using errcode = '22023'; end if;
  if char_length(txt) > 200 then raise exception 'reason too long' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('points_manual:' || e.player_id::text || ':' || e.month::text));
  if e.status <> 'active' then return; end if;
  perform points_ledger_apply(e.club_id, 'manual', e.source_id, '[]'::jsonb, txt);
end $$;
revoke execute on function points_manual_cancel(uuid, text) from public, anon;
grant execute on function points_manual_cancel(uuid, text) to authenticated;

commit;
