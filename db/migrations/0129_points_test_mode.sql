-- 0129: тестовый запуск новой системы баллов до 1 декабря (#18).
--  * Правила баллов действуют с 2026-11-01, то есть учитываются и занятия 1–5 ноября: в конце миграции журнал пересчитывается по уже сохранённым отметкам и матчам (тестовая версия с теми же параметрами, что и стартовая). Журнал считается параллельно со старой системой.
--  * Дата старта points_start (раздел «Старт подсчёта баллов») теперь ограничивает и новый журнал: события раньше этой даты баллов не дают,
--    серии считаются с неё заново. При установке или смене даты журнал пересчитывается сам: тестовые начисления закрываются (статус «отменено»,
--    история и аудит сохраняются), а при снятии даты возвращаются.
--  * points_consistency_run(fix): внутренний пересчёт всех источников без проверки прав (для триггера и SQL Editor); points_consistency остаётся
--    обёрткой для администратора.
--  * С 2026-11-01 mark_attendance требует отметить всех игроков группы со статусом «Занимается» (правило из 0121), пока points_start не позже занятия.
-- Старые point_events не затрагиваются. Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

-- Правила на дату: версия не действует раньше points_start
create or replace function points_rules_for(c uuid, d date) returns points_rule_versions
language sql stable security definer set search_path = public as $$
  select * from points_rule_versions
   where club_id = c and effective_from <= d and (points_start() is null or d >= points_start())
   order by effective_from desc limit 1
$$;

-- Серии начинаются не раньше первой версии правил и не раньше points_start
create or replace function points_series_scan(p uuid)
returns table (session_id uuid, group_id uuid, day date, status text, streak int, run_start uuid)
language plpgsql stable security definer set search_path = public as $$
declare club uuid; first_eff date; r record; cur int := 0; start_id uuid; prev_group uuid; have_prev boolean := false;
begin
  select pl.club_id into club from players pl where pl.id = p;
  if club is null then return; end if;
  select min(v.effective_from) into first_eff from points_rule_versions v where v.club_id = club;
  if first_eff is null then return; end if;
  first_eff := greatest(first_eff, coalesce(points_start(), first_eff));
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

create or replace function points_consistency_run(fix boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; before_id bigint; n int; drift jsonb := '[]'::jsonb; total int := 0; checked int := 0; exc jsonb := '[]'::jsonb;
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
  loop
    checked := checked + 1;
    select coalesce(max(id), 0) into before_id from points_ledger_audit;
    begin
      case r.st
        when 'group_session' then perform points_reconcile_group_session(r.id);
        when 'individual' then perform points_reconcile_individual(r.id);
        when 'extra' then perform points_reconcile_extra(r.id);
        when 'match' then perform points_reconcile_match(r.id);
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

  -- Исключения: начисление не создано или неполное
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'match_without_score', 'source_id', m.id, 'event_date', m.played_on)), '[]'::jsonb) into exc
    from matches m
   where (m.goals_for is null or m.goals_against is null) and exists (select 1 from match_players mp where mp.match_id = m.id and mp.played);
  exc := exc || coalesce((select jsonb_agg(jsonb_build_object('kind', 'ledger_without_group', 'source_id', l.id, 'event_date', l.event_date, 'player_id', l.player_id))
                            from points_ledger l where l.status = 'active' and l.group_id is null and l.source_type <> 'series_bonus'), '[]'::jsonb);

  if fix and total > 0 then
    insert into audit_log (actor_id, action, entity, entity_id, before, after)
      values (current_user_id(), 'points_consistency_fix', 'points_ledger', null, null, jsonb_build_object('changes', total, 'checked', checked));
  end if;
  return jsonb_build_object('fix', fix, 'checked', checked, 'changes', total, 'drift', drift, 'exceptions', exc);
end $$;
revoke execute on function points_consistency_run(boolean) from public, anon, authenticated;

create or replace function points_consistency(fix boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return points_consistency_run(fix);
end $$;
revoke execute on function points_consistency(boolean) from public, anon;
grant execute on function points_consistency(boolean) to authenticated;

-- Смена points_start пересчитывает журнал после завершения транзакции (удаление + вставка даты дают один пересчёт)
create or replace function points_trg_start_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (case when tg_op = 'DELETE' then old.key else new.key end) = 'points_start' then perform points_consistency_run(true); end if;
  return null;
end $$;
revoke execute on function points_trg_start_changed() from public, anon, authenticated;
create constraint trigger points_start_sync after insert or update or delete on club_settings
  deferrable initially deferred for each row
  execute function points_trg_start_changed();

-- Тестовая версия правил с 2026-11-01: параметры берём у самой ранней версии клуба
insert into points_rule_versions (club_id, effective_from, params, comment)
select v.club_id, date '2026-11-01', v.params, 'Тестовый запуск до 1 декабря'
  from points_rule_versions v
 where v.effective_from = (select min(x.effective_from) from points_rule_versions x where x.club_id = v.club_id)
   and v.effective_from > date '2026-11-01';

-- Пересчёт по уже сохранённым отметкам и матчам (1–5 ноября получают баллы задним числом; повтор ничего не меняет)
select points_consistency_run(true);

commit;
