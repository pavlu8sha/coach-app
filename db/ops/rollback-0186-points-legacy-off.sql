-- Откат 0186 (отключение старой системы баллов). Применять в SQL Editor целиком.
-- Ручные баллы, закрытые сменой даты старта, остаются закрытыми: журнал только добавляется (при необходимости начислить заново).
begin;
drop trigger if exists point_events_archive_freeze on point_events;
drop function if exists point_events_archive_guard();
drop trigger if exists point_events_notify on point_events;
create trigger point_events_notify after insert on point_events for each row execute function notify_bonus();
grant execute on function award_bonus(uuid, int, text), revoke_bonus(uuid), recalc_match_points(uuid) to authenticated;
drop function if exists save_match_tech(uuid, uuid, text, date, text, int, int, jsonb, boolean);

-- тело из 0131
create or replace function points_consistency_run(fix boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare floor_day date; r record; before_id bigint; n int; drift jsonb := '[]'::jsonb; total int := 0; checked int := 0; exc jsonb := '[]'::jsonb;
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

-- тело из 0173
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
    'points', coalesce((select jsonb_agg(jsonb_build_object('child', a2.full_name, 'date', e.occurred_on, 'points', e.points, 'explanation', e.explanation) order by e.occurred_on) from point_events e join active a2 on a2.id = e.player_id where e.occurred_on >= coalesce(points_start(), '-infinity'::date)), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('child', a2.full_name, 'date', p.paid_on, 'amount', p.amount, 'method', p.method) order by p.paid_on) from payments p join active a2 on a2.id = p.player_id), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('child', a2.full_name, 'date', m.played_on, 'team', m.team, 'opponent', m.opponent, 'played', mp.played, 'goals', mp.goals) order by m.played_on) from match_players mp join matches m on m.id = mp.match_id join active a2 on a2.id = mp.player_id), '[]'::jsonb)
  ) into res;
  return res;
end $function$;

-- notify_points_ledger: тело 0130
create or replace function notify_points_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare child text; txt text;
begin
  if new.status <> 'active' or new.supersedes_id is not null or new.points <= 0 then return null; end if;
  if new.source_type not in ('manual', 'match') then return null; end if;
  if new.event_date < tbilisi_day(now()) - 7 then return null; end if;
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

commit;
