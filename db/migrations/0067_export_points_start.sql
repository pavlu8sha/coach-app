-- R-02: выгрузка своих данных не отдаёт баллы раньше даты старта баллов (points_start), так же как RLS на point_events
-- и рейтинг. Остальное тело функции без изменений (см. 0025_consent_controls.sql).
create or replace function export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := current_user_id(); res jsonb;
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  with kids as (
    select pl.id, pl.full_name, g.name gname, pg.consent_version, pg.consent_given_at, pg.consent_revoked_at
    from player_guardians pg join players pl on pl.id = pg.player_id left join groups g on g.id = pl.group_id
    where pg.user_id = me
  ), active as (select * from kids where consent_revoked_at is null)
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
end $$;
