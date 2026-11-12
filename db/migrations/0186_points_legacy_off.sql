-- 0186: отключение старой системы баллов (#504; условия docs/POINTS_LEGACY_OFF_ACCEPTANCE.md). Решения владельца 2026-11-12.
--  * point_events становится замороженным архивом: вставка, правка и прямое удаление молча пропускаются триггером, поэтому
--    mark_attendance, save_match (через apply_match_points), delete_match продолжают работать, но старые баллы не пишут и не стирают.
--    Удаление каскадом (удаление игрока) проходит. Функции старой системы НЕ пересоздаются: 0186 не пересекается с 0180 и 0181.
--  * award_bonus, revoke_bonus, recalc_match_points: права только у владельца (интерфейс их больше не вызывает).
--  * Старое уведомление point_events_notify удалено (новое по журналу 0130 остаётся).
--  * points_consistency_run (тело 0131): действующие ручные баллы с датой раньше points_start закрываются с причиной points_start.
--    Смена даты старта вызывает этот пересчёт (0129), поэтому ноябрьские ручные баллы закроются вместе с остальными. Снятие даты их не возвращает.
--  * export_my_data (тело 0173): раздел points берётся из points_ledger (действующие строки).
--  * save_match_tech: матч и признак технического результата в одной транзакции (родитель не получает уведомление о баллах,
--    которые тут же снимаются).
-- Откат: db/ops/rollback-0186-points-legacy-off.sql. Применять в SQL Editor целиком, сначала db/ops/preflight.sql.
begin;

-- 1. Архив старых баллов
create or replace function point_events_archive_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- каскадное удаление (игрок удалён) приходит из триггера внешнего ключа: глубина больше 1
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  return null;
end $$;
revoke execute on function point_events_archive_guard() from public, anon, authenticated;
drop trigger if exists point_events_archive_freeze on point_events;
create trigger point_events_archive_freeze before insert or update or delete on point_events
  for each row execute function point_events_archive_guard();

drop trigger if exists point_events_notify on point_events;

-- 2. Старые ручные баллы и пересчёт
revoke execute on function award_bonus(uuid, int, text), revoke_bonus(uuid), recalc_match_points(uuid) from public, anon, authenticated;

-- 3. Сверка и смена даты старта закрывают ручные баллы до даты старта (тело 0131 + источник manual)
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

-- 4. Выгрузка данных родителя: тело 0173, раздел points из нового журнала
CREATE OR REPLACE FUNCTION public.export_my_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_user_id(); res jsonb;
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  with kids as (
    select pl.id, pl.full_name, g.name gname, pg.consent_version, pg.consent_given_at, pg.consent_revoked_at
    from player_guardians pg join players pl on pl.id = pg.player_id left join groups g on g.id = pl.group_id
    where pg.user_id = me
  ), active as (select * from kids where parent_access_ok(me, id))
  select jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('display_name', u.display_name, 'telegram_id', u.telegram_id, 'created_at', u.created_at) from users u where u.id = me),
    'children', coalesce((select jsonb_agg(jsonb_build_object('name', full_name, 'group', gname, 'consent_version', consent_version, 'consent_given_at', consent_given_at, 'consent_revoked_at', consent_revoked_at) order by full_name) from kids), '[]'::jsonb),
    'link_requests', coalesce((select jsonb_agg(jsonb_build_object('child', pl.full_name, 'status', r.status, 'created_at', r.created_at, 'decided_at', r.decided_at, 'consent_version', r.consent_version) order by r.created_at) from link_requests r join players pl on pl.id = r.player_id where r.user_id = me), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object('child', a2.full_name, 'date', tbilisi_day(s.starts_at), 'status', at.status) order by s.starts_at) from attendance at join sessions s on s.id = at.session_id join active a2 on a2.id = at.player_id), '[]'::jsonb),
    'points', coalesce((select jsonb_agg(jsonb_build_object('child', a2.full_name, 'date', l.event_date, 'points', l.points, 'explanation',
                 case l.source_type
                   when 'group_session' then 'Тренировка — посещение'
                   when 'individual' then 'Индивидуальная тренировка — посещение'
                   when 'goalkeeper' then 'Вратарская тренировка — посещение'
                   when 'extra' then 'Дополнительная тренировка — посещение'
                   when 'match' then 'Матч'
                   when 'series_bonus' then 'Серия: ' || coalesce(l.components ->> 'threshold', '') || ' тренировок подряд'
                   when 'manual' then 'От тренера: ' || coalesce(nullif(l.components ->> 'note', ''), 'без комментария')
                   else 'Начисление' end) order by l.event_date, l.created_at)
               from points_ledger l join active a2 on a2.id = l.player_id where l.status = 'active'), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('child', a2.full_name, 'date', p.paid_on, 'amount', p.amount, 'method', p.method) order by p.paid_on) from payments p join active a2 on a2.id = p.player_id), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('child', a2.full_name, 'date', m.played_on, 'team', m.team, 'opponent', m.opponent, 'played', mp.played, 'goals', mp.goals) order by m.played_on) from match_players mp join matches m on m.id = mp.match_id join active a2 on a2.id = mp.player_id), '[]'::jsonb)
  ) into res;
  return res;
end $function$;

-- 5. Матч и технический результат одной транзакцией. Права проверяют вложенные функции (save_match, save_match_team, set_match_technical).
create or replace function save_match_tech(m uuid, g uuid, tm text, d date, opp text, gf int, ga int, roster jsonb, tech boolean) returns uuid
language plpgsql set search_path = public as $$
declare mid uuid;
begin
  if tech is null then raise exception 'technical flag required' using errcode = '22023'; end if;
  if m is null and g is null and nullif(trim(tm), '') is not null then
    mid := save_match_team(tm, d, opp, gf, ga, roster);
  else
    mid := save_match(m, g, d, opp, gf, ga, roster);
  end if;
  perform set_match_technical(mid, tech);
  return mid;
end $$;
revoke execute on function save_match_tech(uuid, uuid, text, date, text, int, int, jsonb, boolean) from public, anon;
grant execute on function save_match_tech(uuid, uuid, text, date, text, int, int, jsonb, boolean) to authenticated;

commit;
