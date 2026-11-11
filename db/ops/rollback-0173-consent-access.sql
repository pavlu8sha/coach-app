-- Откат миграции 0173 (#238, PR 2b). Запускать только по решению владельца, в SQL Editor целиком, в одной транзакции.
-- Возвращает определения функций, какими они были до 0173 (снимок из всех миграций master e22ee03), и удаляет новые объекты.
-- История и состояния согласий не трогаются. Отзывы по новой модели после отката снова не влияют на доступ при прежних правилах.
-- Проще и безопаснее сначала просто выключить режим: delete from club_settings where key = 'consent.mode';
begin;
drop trigger if exists consent_mode_guard on club_settings;

CREATE OR REPLACE FUNCTION public.booking_board()
 RETURNS TABLE(kind text, session_id uuid, starts_at timestamp without time zone, ends_at timestamp without time zone, title text, place text, capacity integer, amount numeric, booked jsonb, mine jsonb, eligible jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare now_local timestamp := now() at time zone 'Asia/Tbilisi';
begin
  if current_user_id() is null or not (is_admin() or booking_is_parent()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select case when s.goalkeepers then 'goalkeeper' else 'individual' end, s.id, s.starts_at, s.ends_at,
    coalesce(s.topic, case when s.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end), null::text,
    ind_cap(s.club_id, s.goalkeepers), ind_price(s.club_id, s.starts_at::date),
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', b.amount) order by pl.full_name)
              from individual_bookings b join players pl on pl.id = b.player_id where b.session_id = s.id and is_guardian_of(b.player_id)), '[]'::jsonb),
    null::jsonb
  from individual_sessions s where s.starts_at >= now_local and s.starts_at < now_local + interval '60 days'
  union all
  select 'extra', e.id, e.starts_on::timestamp + coalesce(e.starts_time, time '00:00'),
    case when e.ends_time is not null then e.starts_on::timestamp + e.ends_time end, 'Дополнительная тренировка', e.place, extra_session_cap(e.id), e.amount,
    coalesce((select jsonb_agg(pl.full_name order by pl.full_name) from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', pl.full_name, 'paid', b.paid, 'amount', coalesce(b.paid_amount, e.amount)) order by pl.full_name)
              from extra_bookings b join players pl on pl.id = b.player_id where b.session_id = e.id and is_guardian_of(b.player_id)), '[]'::jsonb),
    case when not e.targeted then null::jsonb
         else coalesce((select jsonb_agg(g.player_id) from player_guardians g where g.user_id = current_user_id() and g.consent_revoked_at is null and extra_eligible(e.id, g.player_id)), '[]'::jsonb) end
  from extra_sessions e where e.cancelled_at is null and e.starts_on >= now_local::date and e.starts_on < now_local::date + 60
    and (is_admin() or not e.targeted
         or exists (select 1 from extra_bookings b where b.session_id = e.id and is_guardian_of(b.player_id))
         or exists (select 1 from player_guardians g where g.user_id = current_user_id() and g.consent_revoked_at is null and extra_eligible(e.id, g.player_id)))
  order by 3, 1;
end $function$;

CREATE OR REPLACE FUNCTION public.booking_family_notice(c uuid, direction text, nk text, ref uuid, pls uuid[], head text, tail text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record;
begin
  if c is null or not booking_notify_enabled(c) or coalesce(cardinality(pls), 0) = 0 then return; end if;
  for r in select g.user_id, string_agg(pl.full_name, ', ' order by pl.full_name) as names
             from player_guardians g join players pl on pl.id = g.player_id
            where g.player_id = any(pls) and g.consent_revoked_at is null
            group by g.user_id loop
    if ref is not null and not booking_notice_once(nk, ref, r.user_id) then continue; end if;
    if direction is null then perform enqueue_notification(r.user_id, nk, head || r.names || tail);
    else perform enqueue_direction_notification(r.user_id, direction, nk, head || r.names || tail); end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.booking_is_parent()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from player_guardians g where g.user_id = current_user_id() and g.consent_revoked_at is null)
$function$;

CREATE OR REPLACE FUNCTION public.booking_options_by_telegram(p_telegram_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare u uuid; out jsonb;
begin
  select id into u from users where telegram_id = p_telegram_id;
  if u is null then return jsonb_build_object('ok', false, 'code', 'unknown_user'); end if;
  perform set_config('request.jwt.claim.sub', u::text, true);
  with kids as (
    select pl.id, pl.full_name from player_guardians g join players pl on pl.id = g.player_id
     where g.user_id = u and g.consent_revoked_at is null and pl.status = 'active'
  ), b as (
    select * from booking_board() where kind in ('individual', 'goalkeeper', 'extra')
  ), rows as (
    select b.kind, b.session_id, b.starts_at, b.capacity, b.booked, b.amount,
           coalesce((select jsonb_agg(jsonb_build_object('id8', left(k.id::text, 8), 'name', k.full_name) order by k.full_name)
                       from kids k
                      where not exists (select 1 from individual_bookings x where x.session_id = b.session_id and x.player_id = k.id)
                        and not exists (select 1 from extra_bookings x where x.session_id = b.session_id and x.player_id = k.id)
                        and (b.kind <> 'extra' or extra_eligible(b.session_id, k.id))), '[]'::jsonb) as children
      from b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.session_id, 'kind', r.kind, 'label', booking_session_label(r.kind, r.session_id),
           'price', r.amount, 'free', (r.capacity is null or jsonb_array_length(r.booked) < r.capacity),
           'children', r.children) order by r.starts_at, r.session_id), '[]'::jsonb)
    into out
    from rows r
   where jsonb_array_length(r.children) > 0;
  return jsonb_build_object('ok', true, 'sessions', out);
end $function$;

CREATE OR REPLACE FUNCTION public.booking_tg_child(u uuid, p_child text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r uuid; n int;
begin
  if u is null or p_child is null or p_child !~ '^[0-9a-f]{8}$' then return null; end if;
  select count(*), min(g.player_id::text)::uuid into n, r
    from player_guardians g
   where g.user_id = u and g.consent_revoked_at is null and g.player_id::text like p_child || '%';
  if n is distinct from 1 then return null; end if;
  return r;
end $function$;

-- camp_broadcast_audience и camp_broadcast_targets в редакции 0172 (откатывает и дельту 0175)
create or replace function camp_broadcast_audience(cid uuid, k text, b text) returns table (user_id uuid, name text, msg text, status text)
language plpgsql stable security definer set search_path = public as $$
declare c camps;
begin
  select * into c from camps where id = cid;
  if k = 'info' then
    return query
      select x.uid, camp_notify_name(u.display_name), 'Сбор «' || left(c.name, 200) || E'»:\n' || b,
             case when not u.notifications_enabled then 'notifications_off'
                  when (select count(*) from notifications n where n.user_id = x.uid and n.kind like 'camp\_broadcast\_%' and n.created_at > now() - interval '1 day') >= 3 then 'daily_limit'
                  else 'ok' end
        from (select distinct g.user_id as uid
                from player_guardians g
                join players p on p.id = g.player_id and p.club_id = c.club_id and p.status = 'active'
               where g.consent_revoked_at is null) x
        join users u on u.id = x.uid
       order by x.uid;
  else
    return query
      with debt as (
        select cp.id, cp.player_id, cp.owner_user_id,
               camp_notify_name(coalesce(pl.full_name, cp.guest_name)) as child,
               cp.amount - coalesce((select sum(pm.amount) from camp_payments pm where pm.participant_id = cp.id), 0) as rest
          from camp_participants cp left join players pl on pl.id = cp.player_id
         where cp.camp_id = cid and cp.status = 'registered'),
      fam as (
        select g.user_id as uid, d.child, d.rest from debt d join player_guardians g on g.player_id = d.player_id and g.consent_revoked_at is null where d.rest > 0
        union all
        select d.owner_user_id, d.child, d.rest from debt d where d.rest > 0 and d.owner_user_id is not null)
      select f.uid, camp_notify_name(u.display_name),
             'Напоминание об оплате сбора «' || left(c.name, 200) || E'».\nОсталось внести:\n'
             || string_agg(f.child || ': ' || trim(to_char(f.rest, 'FM999999990.00')) || ' ₾', E'\n' order by f.child)
             || case when c.full_payment_deadline is not null then E'\nСрок полной оплаты: ' || to_char(c.full_payment_deadline, 'DD.MM.YYYY') || '.' else '' end
             || case when b is not null then E'\n\n' || b else '' end
             || E'\nОткройте приложение, раздел «Сборы».',
             case when not u.notifications_enabled then 'notifications_off'
                  when (select count(*) from notifications n where n.user_id = f.uid and n.kind like 'camp\_broadcast\_%' and n.created_at > now() - interval '1 day') >= 3 then 'daily_limit'
                  else 'ok' end
        from fam f join users u on u.id = f.uid
       group by f.uid, u.display_name, u.notifications_enabled
       order by f.uid;
  end if;
end $$;

create or replace function camp_broadcast_targets(cid uuid, k text, b text) returns table (user_id uuid, msg text)
language sql stable security definer set search_path = public as $$
  select a.user_id, a.msg from camp_broadcast_audience(cid, k, b) a where a.status = 'ok' order by a.user_id
$$;


CREATE OR REPLACE FUNCTION public.camp_broadcast_unreachable(cid uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from camp_participants cp
   where cp.camp_id = cid and cp.status = 'registered'
     and cp.amount - coalesce((select sum(pm.amount) from camp_payments pm where pm.participant_id = cp.id), 0) > 0
     and not exists (
       select 1 from camp_broadcast_targets(cid, 'reminder', null) t
        where t.user_id = cp.owner_user_id
           or t.user_id in (select g.user_id from player_guardians g where g.player_id = cp.player_id and g.consent_revoked_at is null))
$function$;

CREATE OR REPLACE FUNCTION public.camp_document_finish(did uuid, ok boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d camp_documents; c camps; u uuid; msg text;
begin
  select * into d from camp_documents where id = did;
  if not found then raise exception 'not pending' using errcode = '22023'; end if;
  perform 1 from camps where id = d.camp_id for update;
  select * into d from camp_documents where id = did for update;
  if d.status <> 'pending' then raise exception 'not pending' using errcode = '22023'; end if;
  if not coalesce(ok, false) then
    update camp_documents set status = 'failed' where id = did;
    return;
  end if;
  -- Брошенная загрузка (старше часа) не публикуется; строку пометит сорвавшейся следующая загрузка
  if d.created_at < now() - interval '1 hour' then raise exception 'not pending' using errcode = '22023'; end if;
  update camp_documents set status = 'ready', ready_at = now() where id = did;
  if d.removed_at is not null then return; end if;
  -- Ошибка уведомления публикацию не отменяет. На один документ не больше трёх сообщений за сутки.
  begin
    select * into c from camps where id = d.camp_id;
    if not camp_notify_enabled(c.club_id) then return; end if;
    if (select count(*) from camp_documents where doc_id = d.doc_id and status = 'ready' and ready_at > now() - interval '1 day') > 3 then return; end if;
    msg := 'Сбор «' || c.name || '»: ' || case when d.version = 1 then 'опубликован' else 'обновлён' end
      || ' документ «' || d.title || E'».\nОткройте приложение, раздел «Сборы».';
    for u in
      select distinct x.uid from (
        select cp.owner_user_id as uid from camp_participants cp
         where cp.camp_id = d.camp_id and cp.status = 'registered' and cp.owner_user_id is not null
        union
        select g.user_id from camp_participants cp join player_guardians g on g.player_id = cp.player_id
         where cp.camp_id = d.camp_id and cp.status = 'registered' and g.consent_revoked_at is null) x
    loop
      -- не больше пяти сообщений о документах одному человеку за сутки
      continue when (select count(*) from notifications n where n.user_id = u and n.kind = 'camp_document' and n.created_at > now() - interval '1 day') >= 5;
      perform enqueue_notification(u, 'camp_document', msg);
    end loop;
  exception when others then
    raise warning 'camp_document_finish: %', sqlerrm;
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.camp_has_my_child(cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from camp_participants cp
                  where cp.camp_id = cid
                    and (cp.owner_user_id = current_user_id()
                         or exists (select 1 from player_guardians g where g.player_id = cp.player_id and g.user_id = current_user_id() and g.consent_revoked_at is null)))
$function$;

CREATE OR REPLACE FUNCTION public.camp_is_confirmed(cid uuid, u uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u is not null and exists (
    select 1 from camp_participants cp
     where cp.camp_id = cid and cp.status = 'registered'
       and (cp.owner_user_id = u
            or exists (select 1 from player_guardians g where g.player_id = cp.player_id and g.user_id = u and g.consent_revoked_at is null)))
$function$;

CREATE OR REPLACE FUNCTION public.camp_visible_to_parent(cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from camps c
      join players p on p.club_id = c.club_id and p.status = 'active'
      join player_guardians g on g.player_id = p.id
     where c.id = cid and c.active and g.user_id = current_user_id() and g.consent_revoked_at is null)
$function$;

CREATE OR REPLACE FUNCTION public.decide_link(r uuid, approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare req link_requests; created boolean; c record;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock_shared(hashtext('parental_consent_model'));
  update link_requests
     set status = case when approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = current_user_id()
   where id = r and status = 'pending'
   returning * into req;
  if req.id is null then raise exception 'request not found or already decided'; end if;
  if approve then
    insert into player_guardians (player_id, user_id, consent_version, consent_given_at)
      values (req.player_id, req.user_id, coalesce(req.consent_version, 'link-request-v0'), coalesce(req.consent_given_at, now()))
      on conflict (player_id, user_id) do update
        set consent_revoked_at = null, consent_version = excluded.consent_version, consent_given_at = excluded.consent_given_at
      returning (xmax = 0) into created;
    if created then
      for c in select consent_type from parental_consents
                where parent_user_id = req.user_id and player_id = req.player_id and status = 'granted' order by consent_type loop
        perform consent_record(req.user_id, req.player_id, c.consent_type, 'revoked', null, 'system', current_user_id());
      end loop;
    end if;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.enqueue_to_guardians(p uuid, k text, t text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g uuid;
begin
  for g in select user_id from player_guardians where player_id = p and consent_revoked_at is null loop
    perform enqueue_notification(g, k, t);
  end loop;
end $function$;

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
end $function$;

CREATE OR REPLACE FUNCTION public.extra_recipients(s uuid)
 RETURNS TABLE(user_id uuid, player_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select g.user_id, g.player_id
    from player_guardians g join players pl on pl.id = g.player_id
    join extra_sessions e on e.id = s and e.targeted
   where g.consent_revoked_at is null and pl.status = 'active' and extra_eligible(s, g.player_id)
$function$;

CREATE OR REPLACE FUNCTION public.first_wave_add(dirs text[], pls uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d text; n int := 0; k int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(cardinality(dirs), 0) = 0 or coalesce(cardinality(pls), 0) = 0 then return 0; end if;
  foreach d in array dirs loop
    if d not in ('ind_sat', 'ind_sun', 'goalkeeper') then raise exception 'bad direction' using errcode = '22023'; end if;
    insert into first_wave_children (player_id, direction, added_by)
      select pl.id, d, current_user_id() from players pl where pl.id = any(pls) on conflict do nothing;
    insert into notification_prefs (user_id, direction, enabled, source)
      select distinct g.user_id, d, true, 'admin' from player_guardians g
       where g.player_id = any(pls) and g.consent_revoked_at is null
      on conflict (user_id, direction) do update set enabled = true, updated_at = now() where notification_prefs.source = 'admin';
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.first_wave_friday(dry boolean DEFAULT true)
 RETURNS TABLE(direction text, recipients integer, sent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d text; c uuid; pls uuid[]; ref uuid; n int; on_ boolean; head text; lbl text;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  foreach d in array array['ind_sat', 'ind_sun', 'goalkeeper'] loop
    ref := md5('first_wave_friday:' || d)::uuid;
    lbl := case d when 'ind_sat' then 'индивидуальные тренировки в субботу' when 'ind_sun' then 'индивидуальные тренировки в воскресенье' else 'вратарские тренировки' end;
    sent := false;
    recipients := 0;
    for c in select distinct pl.club_id from first_wave_children f join players pl on pl.id = f.player_id where f.direction = d loop
      pls := array(select f.player_id from first_wave_children f join players pl on pl.id = f.player_id
                    where f.direction = d and pl.club_id = c and pl.status = 'active' and not first_wave_has_booking(f.player_id, d));
      select count(distinct g.user_id)::int into n from player_guardians g
       where g.player_id = any(pls) and g.consent_revoked_at is null and notify_direction_enabled(g.user_id, d)
         and not exists (select 1 from booking_notice_log l where l.kind = 'first_wave_friday' and l.ref_id = ref and l.user_id = g.user_id);
      recipients := recipients + n;
      if not dry and booking_notify_enabled(c) and n > 0 then
        perform booking_family_notice(c, d, 'first_wave_friday', ref, pls,
          'Запись на ' || lbl || ' теперь в приложении («Расписание» → «Запись на занятия»). Для: ',
          '. Когда откроются места, мы пришлём отдельное сообщение. Настроить уведомления можно в профиле.');
        sent := true;
      end if;
    end loop;
    direction := d;
    return next;
  end loop;
end $function$;

drop function if exists first_wave_list();

CREATE OR REPLACE FUNCTION public.first_wave_list()
 RETURNS TABLE(player_id uuid, name text, direction text, parents integer, enabled integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select f.player_id, pl.full_name, f.direction,
         (select count(distinct g.user_id)::int from player_guardians g where g.player_id = f.player_id and g.consent_revoked_at is null),
         (select count(distinct g.user_id)::int from player_guardians g where g.player_id = f.player_id and g.consent_revoked_at is null and notify_direction_enabled(g.user_id, f.direction))
    from first_wave_children f join players pl on pl.id = f.player_id
   order by f.direction, pl.full_name;
end $function$;

CREATE OR REPLACE FUNCTION public.first_wave_remove(d text, p uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from first_wave_children where direction = d and player_id = p;
  delete from notification_prefs np
   where np.direction = d and np.source = 'admin'
     and np.user_id in (select g.user_id from player_guardians g where g.player_id = p)
     and not exists (select 1 from first_wave_children f join player_guardians g2 on g2.player_id = f.player_id
                      where f.direction = d and g2.user_id = np.user_id and g2.consent_revoked_at is null);
end $function$;

CREATE OR REPLACE FUNCTION public.group_parents(g uuid)
 RETURNS TABLE(player_id uuid, player_name text, parent_name text, telegram_id bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (is_admin() or is_coach_of_group(g)) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select pl.id, pl.full_name, u.display_name, u.telegram_id
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.consent_revoked_at is null
    join consent_versions cv on cv.version = pg.consent_version and cv.coach_contacts
    join users u on u.id = pg.user_id
    where pl.group_id = g and pl.status = 'active'
    order by pl.full_name, u.display_name;
end $function$;

CREATE OR REPLACE FUNCTION public.is_any_guardian()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from player_guardians
    where user_id = current_user_id() and consent_revoked_at is null
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_guardian_in_group(g uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from players pl
    join player_guardians pg on pg.player_id = pl.id
    where pl.group_id = g and pg.consent_revoked_at is null
      and (pg.user_id = current_user_id() or exists (select 1 from child_links c where c.player_id = pl.id and c.user_id = current_user_id()))
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_guardian_of(p uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from player_guardians g
    where g.player_id = p and g.user_id = current_user_id() and g.consent_revoked_at is null
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_self_player(p uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from child_links c
    where c.player_id = p and c.user_id = current_user_id()
      and exists (select 1 from player_guardians g where g.player_id = p and g.consent_revoked_at is null)
  )
$function$;

CREATE OR REPLACE FUNCTION public.match_rsvp_remind_unanswered(m uuid)
 RETURNS TABLE(queued integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare mt matches; u uuid; q int := 0; s int := 0;
begin
  mt := rsvp_lock_match(m);
  if mt.lifecycle_status <> 'published' then raise exception 'match is not published' using errcode = '55000'; end if;
  if clock_timestamp() >= mt.starts_at then raise exception 'match already started' using errcode = '55000'; end if;
  for u in
    select distinct g.user_id from match_invitations i join player_guardians g on g.player_id = i.player_id and g.consent_revoked_at is null
     where i.match_id = m and i.status = 'invited' and i.response is null order by g.user_id
  loop
    if rsvp_claim_reminder(m, u, 'manual', current_user_id()) then q := q + 1; else s := s + 1; end if;
  end loop;
  if q > 0 then perform rsvp_log(mt, 'manual_reminder', jsonb_build_object('queued', q, 'skipped', s)); end if;
  return query select q, s;
end $function$;

CREATE OR REPLACE FUNCTION public.my_tournaments()
 RETURNS TABLE(id uuid, team text, kind text, name text, starts_on date, games integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.id, t.team, t.kind, t.name, t.starts_on,
    (select count(*)::int from matches m where m.tournament_id = t.id)
  from tournaments t
  where exists (
    select 1
    from tournament_fees f
    join player_guardians pg on pg.player_id = f.player_id
    where f.tournament_id = t.id
      and pg.user_id = auth.uid()
      and pg.consent_revoked_at is null
  )
  order by t.starts_on desc nulls last, t.name;
$function$;

CREATE OR REPLACE FUNCTION public.parent_calendar(p_player uuid, p_from date, p_to date)
 RETURNS TABLE(event_id text, event_date date, event_time time without time zone, event_type text, title text, location text, event_status text, attendance_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := current_user_id();
  player_group uuid;
  player_group_name text;
  player_club uuid;
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_player is null or p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 180 then raise exception 'date range too large' using errcode = '22023'; end if;
  if not exists (
    select 1 from player_guardians pg
    where pg.player_id = p_player and pg.user_id = me and pg.consent_revoked_at is null
  ) then raise exception 'forbidden' using errcode = '42501'; end if;

  select pl.group_id, gr.name, pl.club_id into player_group, player_group_name, player_club
  from players pl left join groups gr on gr.id = pl.group_id where pl.id = p_player;

  return query
  select e.event_id, e.event_date, e.event_time, e.event_type, e.title, e.location, e.event_status, e.attendance_status
  from (
    select
      ('match:' || m.id::text)::text as event_id, m.played_on as event_date, null::time as event_time, 'match'::text as event_type,
      coalesce(nullif(trim(m.opponent), ''), 'Матч')::text as title, null::text as location,
      case when m.goals_for is not null and m.goals_against is not null then 'completed'
           when m.played_on < (now() at time zone 'Asia/Tbilisi')::date then 'past'
           else 'upcoming' end::text as event_status,
      case when mp.played then 'played' when mp.match_id is not null then 'not_played' else null end::text as attendance_status
    from matches m
    left join match_players mp on mp.match_id = m.id and mp.player_id = p_player
    where m.played_on between p_from and p_to
      and (
        (player_group is not null and (
          m.team = player_group_name
          or (right(player_group_name, 2) in ('-A', '-B', '-C') and left(player_group_name, length(player_group_name) - 2) = m.team)
        ))
        or mp.player_id is not null
      )

    union all

    select * from (
    select distinct on (tl.held_on, tl.starts_at, tl.kind)
      ('training-log:' || tl.id::text)::text, tl.held_on, tl.starts_at, 'training'::text,
      case tl.kind when 'Вратарская' then 'Вратарская тренировка'
        when 'Индивидуальная' then 'Индивидуальная тренировка' else 'Тренировка' end::text,
      tl.location::text, 'past'::text, null::text
    from training_log tl
    where player_group is not null and tl.club_id = player_club
      and tl.group_label = player_group_name and tl.held and tl.held_on between p_from and p_to
      and not exists (
        select 1 from sessions s
        where s.group_id = player_group
          and (s.starts_at at time zone 'Asia/Tbilisi')::date = tl.held_on
      )
    order by tl.held_on, tl.starts_at, tl.kind, tl.id
    ) tlr

    union all

    select
      ('session:' || s.id::text)::text, (s.starts_at at time zone 'Asia/Tbilisi')::date,
      (s.starts_at at time zone 'Asia/Tbilisi')::time, 'training'::text,
      case when s.kind = 'training' then 'Групповая тренировка' else 'Тренировка' end::text,
      gr.location::text,
      case when (s.starts_at at time zone 'Asia/Tbilisi')::date < (now() at time zone 'Asia/Tbilisi')::date
        then 'past' else 'upcoming' end::text,
      a.status::text
    from sessions s
    join groups gr on gr.id = s.group_id
    left join attendance a on a.session_id = s.id and a.player_id = p_player
    where player_group is not null and s.group_id = player_group
      and (s.starts_at at time zone 'Asia/Tbilisi')::date between p_from and p_to

    union all

    -- Индивидуальные/вратарские занятия включаем только при активной записи именно этого ребёнка.
    select
      ('individual:' || ind.id::text)::text,
      ind.starts_at::date,
      ind.starts_at::time,
      'training'::text,
      (case when ind.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end
        || case when nullif(trim(ind.topic), '') is not null then ': ' || trim(ind.topic) else '' end)::text,
      null::text,
      case when ind.starts_at::date < (now() at time zone 'Asia/Tbilisi')::date then 'past' else 'upcoming' end::text,
      case when ib.attended then 'present' when ib.attended is false then 'absent' else null end::text
    from individual_sessions ind
    join individual_bookings ib on ib.session_id = ind.id and ib.player_id = p_player
    where ind.club_id = player_club
      and ind.starts_at::date between p_from and p_to

    union all

    -- Дополнительные занятия тоже доступны только если ребёнок записан на них.
    select
      ('extra:' || ex.id::text)::text,
      ex.starts_on,
      null::time,
      'training'::text,
      'Дополнительная тренировка'::text,
      ex.place::text,
      case when ex.starts_on < (now() at time zone 'Asia/Tbilisi')::date then 'past' else 'upcoming' end::text,
      case when eb.attended then 'present' when eb.attended is false then 'absent' else null end::text
    from extra_sessions ex
    join extra_bookings eb on eb.session_id = ex.id and eb.player_id = p_player
    where ex.club_id = player_club
      and ex.cancelled_at is null
      and ex.starts_on between p_from and p_to

    union all

    select
      ('schedule:' || ws.id::text || ':' || cal.day::date::text)::text,
      cal.day::date, ws.starts_at, 'training'::text,
      case ws.kind when 'Вратарская' then 'Вратарская тренировка'
        when 'Индивидуальная' then 'Индивидуальная тренировка' else 'Тренировка по расписанию' end::text,
      coalesce(ws.location, gr.location)::text, 'upcoming'::text, null::text
    from weekly_schedule ws
    join groups gr on gr.id = ws.group_id
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') cal(day)
    where player_group is not null and ws.group_id = player_group
      and extract(isodow from cal.day)::int = ws.weekday
      and cal.day::date >= (now() at time zone 'Asia/Tbilisi')::date
      and not exists (
        select 1 from sessions s
        where s.group_id = ws.group_id
          and (s.starts_at at time zone 'Asia/Tbilisi')::date = cal.day::date
          and (s.starts_at at time zone 'Asia/Tbilisi')::time = ws.starts_at
      )
      and not exists (
        select 1 from training_log tl where tl.club_id = gr.club_id
          and tl.group_label = player_group_name and tl.held and tl.held_on = cal.day::date
      )
  ) e
  order by e.event_date, e.event_time nulls last, e.event_type, e.event_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.parent_debts()
 RETURNS TABLE(player_id uuid, month date, tariff numeric, paid numeric, debt numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cur date := date_trunc('month', tbilisi_day(now()))::date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
  with kids as (
    select pl.id pid, pl.club_id, pl.group_id gid
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.user_id = current_user_id() and pg.consent_revoked_at is null
    where pl.status = 'active'
      and exists (select 1 from club_settings cs where cs.club_id = pl.club_id and cs.key = 'parent_debt_enabled' and cs.value = 'true')
  ), mon as (
    select generate_series(debt_start(), cur, interval '1 month')::date m
  ), base as (
    select k.pid, k.club_id, mo.m, coalesce(s.group_id, k.gid) g, coalesce(s.discount, false) disc, coalesce(s.written_off, false) wo
    from kids k cross join mon mo
    left join subscriptions s on s.player_id = k.pid and s.month = mo.m
    where mo.m = cur or s.id is not null
  ), paid_m as (
    select p.player_id pid, p.pay_month m, sum(p.amount) amt from payments p group by 1, 2
  ), calc as (
    select b.pid, b.m, tariff_for(b.club_id, b.g, b.m) t, coalesce(pm.amt, 0) pd, b.disc, b.wo
    from base b
    left join paid_m pm on pm.pid = b.pid and pm.m = b.m
    left join groups gr on gr.id = b.g
    where coalesce(lower(gr.name), '') <> 'индивидуальные / вратарские'
  )
  select c.pid, c.m, c.t, c.pd,
         case when c.wo or c.disc then 0::numeric else greatest(c.t - c.pd, 0) end
  from calc c where c.t is not null
    and (c.pd > 0 or not player_paused_month(c.pid, c.m))
  order by c.m desc, c.pid;
end $function$;

CREATE OR REPLACE FUNCTION public.parent_dues()
 RETURNS TABLE(player_id uuid, kind text, title text, on_date date, due numeric, paid numeric, debt numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare local_now timestamp := now() at time zone 'Asia/Tbilisi'; today date := (now() at time zone 'Asia/Tbilisi')::date;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
  with kids as (
    select pl.id pid
    from players pl
    join player_guardians pg on pg.player_id = pl.id and pg.user_id = current_user_id() and pg.consent_revoked_at is null
    where pl.status = 'active'
      and exists (select 1 from club_settings cs where cs.club_id = pl.club_id and cs.key = 'parent_debt_enabled' and cs.value = 'true')
  )
  select o.player_id, 'eq'::text,
         coalesce((select string_agg(l.kit, ' + ' order by l.kit) from equipment_order_lines l where l.order_id = o.id), 'Экипировка'),
         o.ordered_on, o.total, o.paid, greatest(o.total - o.paid, 0)
  from equipment_orders o join kids k on k.pid = o.player_id
  union all
  select b.player_id, 'ind'::text, case when s.goalkeepers then 'Вратарская тренировка' else 'Индивидуальная тренировка' end,
         s.starts_at::date, b.amount, case when b.paid then b.amount else 0 end, case when b.paid then 0 else b.amount end
  from individual_bookings b join individual_sessions s on s.id = b.session_id join kids k on k.pid = b.player_id
  where s.starts_at < local_now
  union all
  select b.player_id, 'extra'::text, 'Дополнительная тренировка' || coalesce(', ' || s.place, ''),
         s.starts_on, s.amount, case when b.paid then coalesce(b.paid_amount, s.amount) else 0 end,
         case when b.paid then greatest(s.amount - coalesce(b.paid_amount, s.amount), 0) else s.amount end
  from extra_bookings b join extra_sessions s on s.id = b.session_id join kids k on k.pid = b.player_id
  where s.starts_on <= today and s.cancelled_at is null
  union all
  select cp.player_id, 'camp'::text, c.name, c.starts_on, cp.amount, coalesce(pm.amt, 0), greatest(cp.amount - coalesce(pm.amt, 0), 0)
  from camp_participants cp join camps c on c.id = cp.camp_id join kids k on k.pid = cp.player_id
  left join lateral (select sum(x.amount) amt from camp_payments x where x.participant_id = cp.id) pm on true
  where cp.status = 'registered'
  order by 4 desc;
end $function$;

CREATE OR REPLACE FUNCTION public.parent_first_attendance(p_player uuid)
 RETURNS date
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := current_user_id();
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_player is null then raise exception 'invalid player' using errcode = '22023'; end if;
  if not exists (
    select 1 from player_guardians pg
    where pg.player_id = p_player and pg.user_id = me and pg.consent_revoked_at is null
  ) then raise exception 'forbidden' using errcode = '42501'; end if;

  return (
    select min((s.starts_at at time zone 'Asia/Tbilisi')::date)
    from attendance a join sessions s on s.id = a.session_id
    where a.player_id = p_player
  );
end $function$;

CREATE OR REPLACE FUNCTION public.redeem_child_code(c text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare rec child_codes; role_ text; me uuid := current_user_id();
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select chosen_role into role_ from users where id = me;
  if role_ is distinct from 'child' then raise exception 'wrong role' using errcode = '42501'; end if;
  -- ограничение попыток (каждая попытка, верная и неверная, учитывается; при блокировке счётчик не растёт)
  if not rate_limit_hit('child_code:' || me, 8, 600) or not rate_limit_hit('child_code_all', 200, 600) then
    raise exception 'too many attempts' using errcode = '54000';
  end if;
  select * into rec from child_codes where code = upper(trim(coalesce(c, ''))) and used_at is null and expires_at > now() for update;
  if not found then return null; end if;
  if not exists (select 1 from player_guardians where player_id = rec.player_id and consent_revoked_at is null) then return null; end if;
  if exists (select 1 from child_links where player_id = rec.player_id and user_id <> me) then
    raise exception 'already linked' using errcode = '23505';
  end if;
  insert into child_links (user_id, player_id) values (me, rec.player_id)
    on conflict (user_id) do update set player_id = excluded.player_id, linked_at = now();
  update child_codes set used_at = now() where code = rec.code;
  insert into audit_log (actor_id, action, entity, entity_id, after)
    values (me, 'child_link', 'child_links', rec.player_id, jsonb_build_object('player_id', rec.player_id, 'code_by', rec.created_by));
  return rec.player_id;
end $function$;

CREATE OR REPLACE FUNCTION public.revoke_consent(p uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update player_guardians set consent_revoked_at = now()
   where player_id = p and user_id = current_user_id() and consent_revoked_at is null;
  if not found then raise exception 'link not found'; end if;
  delete from link_requests where user_id = current_user_id() and player_id = p;
  insert into audit_log (actor_id, action, entity, entity_id, after)
    values (current_user_id(), 'revoke_consent', 'player_guardians', p, jsonb_build_object('player_id', p));
end $function$;

CREATE OR REPLACE FUNCTION public.rsvp_auto_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; q int := 0; k text;
begin
  for r in
    select mt.id as m, g.user_id as u, mt.starts_at
      from matches mt
      join match_invitations i on i.match_id = mt.id and i.status = 'invited' and i.response is null
      join player_guardians g on g.player_id = i.player_id and g.consent_revoked_at is null
     where mt.lifecycle_status = 'published' and mt.starts_at > clock_timestamp()
       and clock_timestamp() >= mt.starts_at - interval '48 hours'
       and clock_timestamp() <= coalesce(i.answer_until, mt.starts_at)
       and greatest(coalesce(mt.published_at, '-infinity'), coalesce(mt.rescheduled_at, '-infinity')) < clock_timestamp() - interval '3 hours'
     group by mt.id, g.user_id, mt.starts_at
     order by mt.starts_at, g.user_id
  loop
    k := case when clock_timestamp() >= r.starts_at - interval '25 hours' then 'auto_24h' else 'auto_48h' end;
    if rsvp_claim_reminder(r.m, r.u, k, null) then q := q + 1; end if;
  end loop;
  return q;
end $function$;

CREATE OR REPLACE FUNCTION public.rsvp_notify_match(m uuid, k text, changes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare u uuid;
begin
  for u in
    select distinct g.user_id from match_invitations i
      join player_guardians g on g.player_id = i.player_id and g.consent_revoked_at is null
     where i.match_id = m and i.status = 'invited' order by g.user_id
  loop
    perform rsvp_notify_parent(m, u, k, null, changes);
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.rsvp_notify_parent(m uuid, u uuid, k text, only_players uuid[] DEFAULT NULL::uuid[], changes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare mt matches; r record; names text := ''; btn jsonb := '[]'::jsonb; head text; body text; first_name text;
begin
  select * into mt from matches where id = m;
  if mt.id is null or mt.lifecycle_status not in ('published', 'cancelled') then return; end if;
  for r in
    select i.id as inv, p.full_name, i.response
      from match_invitations i
      join players p on p.id = i.player_id
      join player_guardians g on g.player_id = i.player_id and g.user_id = u and g.consent_revoked_at is null
     where i.match_id = m and i.status = case when k = 'removed' then 'removed' else 'invited' end
       and (only_players is null or i.player_id = any (only_players))
       and (k <> 'reminder' or i.response is null)
     order by p.full_name
  loop
    names := names || case when names = '' then '' else ', ' end || r.full_name;
    if k in ('invite', 'reschedule', 'reminder', 'update') and mt.lifecycle_status = 'published' and (k in ('invite', 'reschedule') or r.response is null) then
      first_name := coalesce(nullif(split_part(r.full_name, ' ', 2), ''), r.full_name);
      btn := btn || jsonb_build_array(jsonb_build_array(
        jsonb_build_object('text', first_name || ': Будет', 'data', 'r:' || r.inv || ':y'),
        jsonb_build_object('text', first_name || ': Не будет', 'data', 'r:' || r.inv || ':n')));
    end if;
  end loop;
  if names = '' then return; end if;
  head := case k when 'invite' then '⚽ Приглашение на матч' when 'reschedule' then '📅 Матч перенесён' when 'cancel' then '❌ Матч отменён'
                 when 'update' then 'ℹ️ Изменились данные матча' when 'removed' then '➖ Игрок исключён из состава на матч' else '⏰ Напоминание о матче' end;
  body := head || E'\n' || mt.team || ' · ' || coalesce(mt.opponent, 'соперник уточняется')
       || E'\n' || rsvp_when(mt.starts_at)
       || coalesce(E'\n' || nullif(concat_ws(', ', mt.venue, mt.address), ''), '')
       || coalesce(E'\n' || mt.notes, '')
       || E'\nИгрок: ' || names;
  if k = 'cancel' then
    body := body || coalesce(E'\nПричина: ' || nullif(mt.cancel_reason, ''), '');
  elsif k = 'update' then
    body := body || coalesce(E'\n\nЧто изменилось:\n' || changes, '') || E'\nПрежние ответы сохранены.';
  elsif k = 'removed' then
    null;
  else
    body := body || case k when 'reschedule' then E'\nПрежние ответы сброшены, ответьте заново' when 'reminder' then E'\nВы ещё не ответили' else E'\nПожалуйста, ответьте' end
         || ' до ' || rsvp_when(match_rsvp_answer_until(mt.starts_at)) || '.';
  end if;
  if exists (select 1 from users where id = u and notifications_enabled) then
    insert into notifications (user_id, kind, text, buttons) values (u, 'rsvp_' || k, body, nullif(btn, '[]'::jsonb));
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.rsvp_notify_players(m uuid, k text, players uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare u uuid;
begin
  if not exists (select 1 from matches mt where mt.id = m and mt.lifecycle_status = 'published' and mt.starts_at > clock_timestamp()) then return; end if;
  for u in select distinct g.user_id from player_guardians g where g.player_id = any (players) and g.consent_revoked_at is null order by g.user_id loop
    perform rsvp_notify_parent(m, u, k, players);
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.search_players_for_link(q text)
 RETURNS TABLE(player_id uuid, full_name text, group_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t text := trim(coalesce(q, ''));
  my_club uuid;
begin
  if current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if char_length(t) < 3 then return; end if;
  if not rate_limit_hit('link_search:' || current_user_id()::text, 30, 600) then
    raise exception 'search limit reached' using errcode = '54000';
  end if;
  select coalesce(u.club_id, (select c.id from clubs c order by c.id limit 1)) into my_club from users u where u.id = current_user_id();
  t := replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select p.id, p.full_name, g.name
    from players p left join groups g on g.id = p.group_id
    where p.status = 'active'
      and p.club_id = my_club
      and p.full_name ilike '%' || t || '%'
      and not exists (select 1 from player_guardians pg where pg.player_id = p.id and pg.user_id = current_user_id() and pg.consent_revoked_at is null)
      and not exists (select 1 from link_requests r where r.player_id = p.id and r.user_id = current_user_id())
    order by p.full_name
    limit 5;
end $function$;

CREATE OR REPLACE FUNCTION public.waitlist_notify(k text, s uuid, moved boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare st record; lbl text; r record; head text; tail text; btn jsonb; any_free boolean;
begin
  select * into st from waitlist_state(k, s);
  if st.club_id is null or st.cancelled or st.starts_at <= now() at time zone 'Asia/Tbilisi' then return; end if;
  if not exists (select 1 from booking_waitlist where session_id = s) then return; end if;
  if not booking_notify_enabled(st.club_id) then return; end if;
  lbl := booking_session_label(k, s);
  any_free := st.free > 0;
  if not any_free and not moved then return; end if;
  for r in
    select g.user_id, string_agg(pl.full_name, ', ' order by pl.full_name) as names,
           jsonb_agg(jsonb_build_array(jsonb_build_object('text', 'Занять место: ' || coalesce(nullif(split_part(pl.full_name, ' ', 2), ''), pl.full_name), 'data', 'w:' || w.id)) order by pl.full_name) as btns
      from booking_waitlist w
      join players pl on pl.id = w.player_id
      join player_guardians g on g.player_id = w.player_id and g.consent_revoked_at is null
     where w.session_id = s
     group by g.user_id
  loop
    if any_free then
      head := case when moved then 'Занятие перенесено, есть свободное место: ' else 'Освободилось место: ' end;
      tail := ' — ' || lbl || '. Нажмите кнопку или подтвердите в приложении (Запись на занятия): место получит тот, кто подтвердит первым. Предложение действует до начала занятия.';
      btn := r.btns;
    else
      head := 'Занятие перенесено: ';
      tail := ' — ' || lbl || '. Вы остаётесь в очереди.';
      btn := null;
    end if;
    if exists (select 1 from users u where u.id = r.user_id and u.notifications_enabled) then
      insert into notifications (user_id, kind, text, buttons)
        values (r.user_id, case when any_free then 'waitlist_offer' else 'waitlist_moved' end, head || r.names || tail, btn);
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.consent_doc_versions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if (new.id, new.consent_type, new.created_at) is distinct from (old.id, old.consent_type, old.created_at) then
    raise exception 'consent version type and identity are immutable' using errcode = '42501';
  end if;
  -- пока версию никто не подтвердил, название и дату вступления можно исправить;
  -- после первого события истории они неизменны
  if (new.version, new.effective_from) is distinct from (old.version, old.effective_from)
     and exists (select 1 from parental_consent_events where version_id = old.id) then
    raise exception 'consent version is immutable (only accepting can change after the first confirmation)' using errcode = '42501';
  end if;
  -- ссылку на текст можно задать один раз и только пока версию никто не подтвердил
  if new.text_ref is distinct from old.text_ref
     and (old.text_ref is not null or exists (select 1 from parental_consent_events where version_id = old.id)) then
    raise exception 'consent version is immutable (text_ref is set once, before the first confirmation)' using errcode = '42501';
  end if;
  return new;
end $function$;

revoke execute on function first_wave_list() from public, anon;
grant execute on function first_wave_list() to authenticated;
drop function if exists parent_access_ok(uuid, uuid);
drop function if exists consent_new_model_for(uuid, uuid);
drop function if exists consent_mode_guard();
drop table if exists consent_test_parents;
-- столбец consent_doc_versions.coach_contacts оставлен (данных версий не теряем); удалить отдельно при необходимости:
-- alter table consent_doc_versions drop column coach_contacts;
commit;
