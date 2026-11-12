-- Откат миграции 0176 (#238, PR 2c). Запускать только по решению владельца, в SQL Editor целиком, в одной транзакции.
-- Возвращает определения функций, какими они были до 0176 (снимок pg_get_functiondef на master c36a5ce с 0173-0175),
-- убирает player_ids и consent_check_attempts и состояние skipped. Строки в состоянии skipped перед откатом переводятся
-- в failed (причина consent сохраняется в last_error): иначе возврат прежнего check невозможен.
-- Данные согласий и очередь (кроме указанных столбцов) не трогаются.
begin;
update notifications set state = 'failed' where state = 'skipped';

-- enqueue_to_guardians
CREATE OR REPLACE FUNCTION public.enqueue_to_guardians(p uuid, k text, t text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g uuid;
begin
  for g in select user_id from player_guardians where player_id = p and parent_access_ok(user_id, player_id) loop
    perform enqueue_notification(g, k, t);
  end loop;
end $function$;

-- booking_family_notice
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
            where g.player_id = any(pls) and parent_access_ok(g.user_id, g.player_id)
            group by g.user_id loop
    if ref is not null and not booking_notice_once(nk, ref, r.user_id) then continue; end if;
    if direction is null then perform enqueue_notification(r.user_id, nk, head || r.names || tail);
    else perform enqueue_direction_notification(r.user_id, direction, nk, head || r.names || tail); end if;
  end loop;
end $function$;

-- rsvp_notify_parent
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
      join player_guardians g on g.player_id = i.player_id and g.user_id = u and parent_access_ok(g.user_id, g.player_id)
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

-- waitlist_notify
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
      join player_guardians g on g.player_id = w.player_id and parent_access_ok(g.user_id, g.player_id)
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

-- camp_broadcast_send
CREATE OR REPLACE FUNCTION public.camp_broadcast_send(cid uuid, k text, b text, expected integer, tok text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t text := camp_broadcast_check(cid, k, b); c camps; n int; bid uuid := gen_random_uuid(); r record; nid uuid; list jsonb; cur text;
begin
  select * into c from camps where id = cid for update;
  if not camp_notify_enabled(c.club_id) then raise exception 'notifications off' using errcode = '22023'; end if;
  if expected is null then raise exception 'confirmation required' using errcode = '22023'; end if;
  if exists (select 1 from camp_broadcasts where camp_id = cid and kind = k and body is not distinct from t and created_at > now() - interval '10 minutes') then
    raise exception 'duplicate broadcast' using errcode = '22023';
  end if;
  if (select count(*) from camp_broadcasts where camp_id = cid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too many broadcasts' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('u', x.user_id, 'm', x.msg) order by x.user_id), '[]'::jsonb),
         md5(coalesce(string_agg(x.user_id::text || ':' || x.msg, '|' order by x.user_id), ''))
    into list, cur from camp_broadcast_targets(cid, k, t) x;
  n := jsonb_array_length(list);
  if n = 0 then raise exception 'no recipients' using errcode = '22023'; end if;
  -- подтверждается не только число, но и состав получателей с текстом каждому
  if n <> expected or tok is distinct from cur then raise exception 'recipients changed' using errcode = '22023'; end if;
  insert into camp_broadcasts (id, camp_id, kind, body, recipients, author_id, author_name)
  values (bid, cid, k, case when k = 'reminder' then 'Напоминание об оплате (остаток каждой семьи подставлен автоматически)' || case when t is not null then E'\n' || t else '' end else t end, n, current_user_id(), (select display_name from users where id = current_user_id()));
  for r in select (e ->> 'u')::uuid as user_id, e ->> 'm' as msg from jsonb_array_elements(list) e loop
    insert into notifications (user_id, kind, text) values (r.user_id, 'camp_broadcast_' || k, r.msg) returning id into nid;
    insert into camp_broadcast_messages (broadcast_id, notification_id, user_id) values (bid, nid, r.user_id);
  end loop;
  return jsonb_build_object('id', bid, 'recipients', n);
end $function$;

-- claim_notifications
CREATE OR REPLACE FUNCTION public.claim_notifications(n integer)
 RETURNS TABLE(id uuid, telegram_id bigint, text text, buttons jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from notifications where state = 'sent' and sent_at < now() - interval '30 days';
  return query
    update notifications nt set attempts = nt.attempts + 1, claimed_at = now()
     where nt.id in (
       select x.id from notifications x
        where x.state = 'pending' and x.attempts < 3 and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
        order by (x.kind like 'camp\_broadcast\_%'), x.created_at limit greatest(1, least(n, 50)) for update skip locked)
    returning nt.id, (select u.telegram_id from users u where u.id = nt.user_id), nt.text, nt.buttons;
end $function$;

-- camp_broadcast_list (прежний тип результата)
drop function if exists camp_broadcast_list(uuid);
CREATE OR REPLACE FUNCTION public.camp_broadcast_list(cid uuid)
 RETURNS TABLE(id uuid, kind text, body text, recipients integer, author_name text, created_at timestamp with time zone, pending integer, sent integer, failed integer, cleared integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform camp_assert_admin();
  return query
    select b.id, b.kind, b.body, b.recipients, b.author_name, b.created_at,
           count(n.id) filter (where n.state = 'pending')::int,
           count(n.id) filter (where n.state = 'sent')::int,
           count(n.id) filter (where n.state = 'failed')::int,
           (b.recipients - count(n.id))::int
      from camp_broadcasts b
      left join camp_broadcast_messages m on m.broadcast_id = b.id
      left join notifications n on n.id = m.notification_id
     where b.camp_id = cid
     group by b.id
     order by b.created_at desc;
end $function$;
revoke execute on function camp_broadcast_list(uuid) from public, anon, authenticated, service_role;
grant execute on function camp_broadcast_list(uuid) to authenticated;
revoke execute on function claim_notifications(int) from public, anon, authenticated;
grant execute on function claim_notifications(int) to service_role;

drop function if exists camp_broadcast_player_ids(uuid, uuid);
drop function if exists enqueue_direction_notification(uuid, text, text, text, uuid[]);
drop function if exists enqueue_notification(uuid, text, text, uuid[]);
alter table notifications drop constraint notifications_state_check;
alter table notifications add constraint notifications_state_check check (state in ('pending', 'sent', 'failed'));
alter table notifications drop column consent_check_attempts;
alter table notifications drop column player_ids;
commit;
