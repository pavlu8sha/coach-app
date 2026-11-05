-- 0124: серии посещаемости и бонусы за рубежи (#18, этап 8).
--  * Серия считается по обычным групповым занятиям (sessions.class = 'regular', kind = 'training') с сохранённой отметкой игрока:
--    «Был» увеличивает серию на 1, любая другая отметка (не был, пропуск по любой причине) обнуляет её. Занятия без сохранённой отметки
--    (отмена клубом, матч вместо тренировки, не отмеченный день) серию не меняют. Перенесённые, внеплановые, индивидуальные,
--    вратарские и дополнительные занятия в серию не входят (у них class не regular или это другие таблицы).
--  * Смена группы: серия начинается заново, личный рекорд и история прежних серий сохраняются.
--  * Серии считаются с даты вступления в силу первой версии правил клуба (стартовый счёт 0, без пересчёта прошлого).
--  * Бонусы: на рубеже series.thresholds (6, 12, 24, 48 → +1, +2, +4, +8 по версии правил на дату занятия, где серия дошла до рубежа).
--    Бонусы суммируются, каждый рубеж даётся один раз за непрерывную серию, после последнего рубежа бонусов нет.
--  * Начисление пересчитывается отложенными триггерами на attendance и sessions по всей истории игрока: исправление отметки задним числом
--    пересчитывает серии и бонусы (ставшие неверными бонусы отменяются, новые создаются). Повтор ничего не меняет.
--  * points_series_info: текущая серия, рекорд, следующий рубеж и история завершённых серий для экранов родителя, ребёнка, тренера и администратора.
-- Старые point_events и points_start не затронуты. Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

-- Разбор истории игрока: по строке на каждое зачётное занятие. streak — длина серии после этого занятия (0 после пропуска).
create or replace function points_series_scan(p uuid)
returns table (session_id uuid, group_id uuid, day date, status text, streak int, run_start uuid)
language plpgsql stable security definer set search_path = public as $$
declare club uuid; first_eff date; r record; cur int := 0; start_id uuid; prev_group uuid; have_prev boolean := false;
begin
  select pl.club_id into club from players pl where pl.id = p;
  if club is null then return; end if;
  select min(v.effective_from) into first_eff from points_rule_versions v where v.club_id = club;
  if first_eff is null then return; end if;
  for r in
    select a.session_id as sid, s.group_id as gid, tbilisi_day(s.starts_at) as d, a.status as st
      from attendance a join sessions s on s.id = a.session_id
     where a.player_id = p and s.class = 'regular' and s.kind = 'training' and tbilisi_day(s.starts_at) >= first_eff
     order by s.starts_at, s.id
  loop
    if have_prev and r.gid is distinct from prev_group then cur := 0; start_id := null; end if;
    prev_group := r.gid;
    have_prev := true;
    if r.st = 'present' then
      cur := cur + 1;
      if cur = 1 then start_id := r.sid; end if;
    else
      cur := 0;
      start_id := null;
    end if;
    session_id := r.sid; group_id := r.gid; day := r.d; status := r.st; streak := cur; run_start := start_id;
    return next;
  end loop;
end $$;
revoke execute on function points_series_scan(uuid) from public, anon, authenticated;

-- Бонусы игрока: приводит журнал к ожидаемому набору по всей истории
create or replace function points_reconcile_series(p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare club uuid; r record; rv points_rule_versions; t jsonb; exp jsonb := '[]'::jsonb; b int;
begin
  select pl.club_id into club from players pl where pl.id = p;
  if club is null then
    select l.club_id into club from points_ledger l where l.source_type = 'series_bonus' and l.source_id = p limit 1;
    if club is not null then perform points_ledger_apply(club, 'series_bonus', p, '[]'::jsonb, 'player_deleted'); end if;
    return;
  end if;
  for r in select * from points_series_scan(p) x where x.status = 'present' loop
    rv := points_rules_for(club, r.day);
    if rv.id is null or not coalesce((rv.params #>> '{enabled,series}')::boolean, false) then continue; end if;
    for t in select * from jsonb_array_elements(rv.params #> '{series,thresholds}') loop
      if (t ->> 'count')::int = r.streak then
        b := (t ->> 'bonus')::int;
        if b > 0 then
          exp := exp || jsonb_build_array(jsonb_build_object('player_id', p, 'group_id', r.group_id, 'event_date', r.day,
                   'reason_code', 'streak_' || r.streak || '_' || r.run_start, 'points', b,
                   'components', jsonb_build_object('threshold', r.streak, 'bonus', b, 'run_start_session', r.run_start, 'session_id', r.session_id),
                   'rule_version_id', rv.id));
        end if;
      end if;
    end loop;
  end loop;
  perform points_ledger_apply(club, 'series_bonus', p, exp, 'series_changed');
end $$;
revoke execute on function points_reconcile_series(uuid) from public, anon, authenticated;

create or replace function points_trg_series_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform points_reconcile_series(old.player_id);
  else
    perform points_reconcile_series(new.player_id);
    if tg_op = 'UPDATE' and new.player_id is distinct from old.player_id then perform points_reconcile_series(old.player_id); end if;
  end if;
  return null;
end $$;
create or replace function points_trg_series_session() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  for pid in select a.player_id from attendance a where a.session_id = new.id loop
    perform points_reconcile_series(pid);
  end loop;
  return null;
end $$;
revoke execute on function points_trg_series_attendance(), points_trg_series_session() from public, anon, authenticated;

-- Отложенные триггеры: расчёт один раз по итоговому состоянию в конце транзакции
create constraint trigger points_series_attendance_sync after insert or update of status, session_id, player_id or delete on attendance
  deferrable initially deferred for each row execute function points_trg_series_attendance();
create constraint trigger points_series_session_sync after update of class, starts_at, group_id, kind on sessions
  deferrable initially deferred for each row execute function points_trg_series_session();

-- Состояние серии для экранов
create or replace function points_series_info(p uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pl players; rv points_rule_versions; r record; cur int := 0; rec int := 0; runs jsonb := '[]'::jsonb;
        run_len int := 0; run_from date; run_to date; run_group uuid; last_break date; nxt jsonb; t jsonb;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into pl from players where id = p;
  if pl.id is null then raise exception 'player not found' using errcode = 'P0002'; end if;
  if not (is_admin() or is_coach_of_player(p) or is_guardian_of(p) or is_self_player(p)) then raise exception 'forbidden' using errcode = '42501'; end if;
  for r in select * from points_series_scan(p) loop
    if r.status = 'present' then
      if run_len = 0 then run_from := r.day; run_group := r.group_id; end if;
      if run_len > 0 and run_group is distinct from r.group_id then
        runs := runs || jsonb_build_array(jsonb_build_object('length', run_len, 'from', run_from, 'to', run_to, 'group_id', run_group));
        run_len := 0; run_from := r.day; run_group := r.group_id;
      end if;
      run_len := run_len + 1; run_to := r.day; cur := r.streak;
      rec := greatest(rec, r.streak);
    else
      if run_len > 0 then
        runs := runs || jsonb_build_array(jsonb_build_object('length', run_len, 'from', run_from, 'to', run_to, 'group_id', run_group));
      end if;
      run_len := 0; cur := 0; last_break := r.day;
    end if;
  end loop;
  -- серия оборвалась сменой группы без пропуска: прежнюю закрываем, когда в новой группе пошла новая (учтено выше); текущая серия остаётся открытой
  -- до вступления правил показываем рубежи первой версии, чтобы экран мог объяснить, что будет
  rv := points_rules_for(pl.club_id, tbilisi_day(now()));
  if rv.id is null then
    select * into rv from points_rule_versions v where v.club_id = pl.club_id order by v.effective_from limit 1;
  end if;
  if rv.id is not null then
    for t in select * from jsonb_array_elements(rv.params #> '{series,thresholds}') loop
      if (t ->> 'count')::int > cur and (nxt is null) then nxt := t; end if;
    end loop;
  end if;
  return jsonb_build_object(
    'current', cur, 'record', rec,
    'current_from', case when run_len > 0 then run_from end,
    'last_break', case when cur = 0 then last_break end,
    'next_threshold', nxt ->> 'count', 'next_bonus', nxt ->> 'bonus',
    'remaining', case when nxt is not null then (nxt ->> 'count')::int - cur end,
    'finished_runs', runs);
end $$;
revoke execute on function points_series_info(uuid) from public, anon;
grant execute on function points_series_info(uuid) to authenticated;

commit;
