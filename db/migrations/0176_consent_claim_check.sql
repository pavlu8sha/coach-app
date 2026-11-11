-- 0176 (#238, PR 2c): проверка согласия родителя непосредственно при выдаче уведомления из очереди.
-- Было: согласие проверялось только при постановке в очередь (0173), отзыв после постановки не подавлял сообщение.
-- Стало: у адресной строки очереди есть список детей (player_ids); claim_notifications при каждой выдаче (в том числе при
-- повторных попытках) проверяет parent_access_ok для получателя по каждому ребёнку. Нет согласия хотя бы по одному: строка
-- получает state = 'skipped' (last_error = 'consent') и не отправляется, не возвращается и после восстановления согласия.
-- Ошибка проверки: строка не выдаётся, считается в consent_check_attempts; после трёх ошибок state = 'failed',
-- last_error = 'consent_check_error'. Ошибка одной строки не останавливает остальные в пачке.
-- Общие сообщения (player_ids is null: старые строки, администраторы, тренеры, гости, link_decided, data_request_done,
-- camp_broadcast_info, camp_document) проверке не подвергаются. Сигнатура claim_notifications и tg-notify не меняются.
-- Режим off/test/all определяет parent_access_ok (не дублируется). Режимы не включаются, данные не меняются.
-- Требует 0173 и 0175 (иначе их применение позже вернёт прежние тела функций). Откат: db/ops/rollback-0176-consent-claim.sql.
-- Условия приёмки: docs/CONSENT_PR2C_ACCEPTANCE.md.
begin;

-- 1. Очередь
alter table notifications add column player_ids uuid[];
alter table notifications add column consent_check_attempts int not null default 0;
alter table notifications drop constraint notifications_state_check;
alter table notifications add constraint notifications_state_check check (state in ('pending', 'sent', 'failed', 'skipped'));

-- 2. Постановка с детьми (старые функции с тремя и четырьмя аргументами остаются для общих сообщений)
create or replace function enqueue_notification(u uuid, k text, t text, pls uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from users where id = u and notifications_enabled) then
    insert into notifications (user_id, kind, text, player_ids) values (u, k, t, pls);
  end if;
end $$;

create or replace function enqueue_direction_notification(u uuid, d text, k text, t text, pls uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if notify_direction_enabled(u, d) then perform enqueue_notification(u, k, t, pls); end if;
end $$;

-- Дети получателя, о которых напоминание об оплате сбора (как в camp_broadcast_audience, ветка reminder, часть родителей)
create or replace function camp_broadcast_player_ids(cid uuid, uid uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array_agg(distinct d.player_id)
    from (select cp.player_id from camp_participants cp
           where cp.camp_id = cid and cp.status = 'registered' and cp.player_id is not null
             and cp.amount - coalesce((select sum(pm.amount) from camp_payments pm where pm.participant_id = cp.id), 0) > 0) d
    join player_guardians g on g.player_id = d.player_id and g.user_id = uid and parent_access_ok(g.user_id, g.player_id)
$$;

-- 4. Постановка: адресные сообщения записывают детей получателя (определения из master с точечными правками)

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
    perform enqueue_notification(g, k, t, array[p]);
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
  for r in select g.user_id, string_agg(pl.full_name, ', ' order by pl.full_name) as names, array_agg(pl.id order by pl.full_name) as pids
             from player_guardians g join players pl on pl.id = g.player_id
            where g.player_id = any(pls) and parent_access_ok(g.user_id, g.player_id)
            group by g.user_id loop
    if ref is not null and not booking_notice_once(nk, ref, r.user_id) then continue; end if;
    if direction is null then perform enqueue_notification(r.user_id, nk, head || r.names || tail, r.pids);
    else perform enqueue_direction_notification(r.user_id, direction, nk, head || r.names || tail, r.pids); end if;
  end loop;
end $function$;

-- rsvp_notify_parent
CREATE OR REPLACE FUNCTION public.rsvp_notify_parent(m uuid, u uuid, k text, only_players uuid[] DEFAULT NULL::uuid[], changes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare mt matches; r record; names text := ''; pids uuid[] := '{}'; btn jsonb := '[]'::jsonb; head text; body text; first_name text;
begin
  select * into mt from matches where id = m;
  if mt.id is null or mt.lifecycle_status not in ('published', 'cancelled') then return; end if;
  for r in
    select i.id as inv, i.player_id as pid, p.full_name, i.response
      from match_invitations i
      join players p on p.id = i.player_id
      join player_guardians g on g.player_id = i.player_id and g.user_id = u and parent_access_ok(g.user_id, g.player_id)
     where i.match_id = m and i.status = case when k = 'removed' then 'removed' else 'invited' end
       and (only_players is null or i.player_id = any (only_players))
       and (k <> 'reminder' or i.response is null)
     order by p.full_name
  loop
    names := names || case when names = '' then '' else ', ' end || r.full_name;
    pids := pids || r.pid;
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
    insert into notifications (user_id, kind, text, buttons, player_ids) values (u, 'rsvp_' || k, body, nullif(btn, '[]'::jsonb), pids);
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
    select g.user_id, string_agg(pl.full_name, ', ' order by pl.full_name) as names, array_agg(distinct w.player_id) as pids,
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
      insert into notifications (user_id, kind, text, buttons, player_ids)
        values (r.user_id, case when any_free then 'waitlist_offer' else 'waitlist_moved' end, head || r.names || tail, btn, r.pids);
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
    insert into notifications (user_id, kind, text, player_ids)
    values (r.user_id, 'camp_broadcast_' || k, r.msg, case when k = 'reminder' then camp_broadcast_player_ids(cid, r.user_id) end) returning id into nid;
    insert into camp_broadcast_messages (broadcast_id, notification_id, user_id) values (bid, nid, r.user_id);
  end loop;
  return jsonb_build_object('id', bid, 'recipients', n);
end $function$;

-- 5. Проверка при выдаче. Порядок выдачи, лимит пачки, закрепление на 2 минуты и возвращаемые поля как в 0170.
create or replace function claim_notifications(n int) returns table (id uuid, telegram_id bigint, text text, buttons jsonb)
language plpgsql security definer set search_path = public as $$
declare r record; ok boolean; pass uuid[] := '{}';
begin
  delete from notifications where state = 'sent' and sent_at < now() - interval '30 days';
  for r in
    select x.id as nid, x.user_id as uid, x.player_ids as pids from notifications x
     where x.state = 'pending' and x.attempts < 3 and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
     order by (x.kind like 'camp\_broadcast\_%'), x.created_at limit greatest(1, least(n, 50)) for update skip locked
  loop
    if r.pids is null then pass := pass || r.nid; continue; end if;
    begin
      -- пустой список и неопределённый результат считаются отсутствием согласия; любое false подавляет сообщение целиком
      ok := cardinality(r.pids) > 0
            and coalesce((select bool_and(coalesce(parent_access_ok(r.uid, p), false)) from unnest(r.pids) as p), false);
      if ok then
        pass := pass || r.nid;
      else
        update notifications set state = 'skipped', last_error = 'consent' where notifications.id = r.nid;
      end if;
    exception when others then
      -- проверка не подтверждена: строка не выдаётся; после трёх ошибок закрывается как failed
      update notifications set consent_check_attempts = consent_check_attempts + 1, last_error = 'consent_check_error',
             state = case when consent_check_attempts + 1 >= 3 then 'failed' else state end
       where notifications.id = r.nid;
    end;
  end loop;
  return query
    update notifications nt set attempts = nt.attempts + 1, claimed_at = now()
     where nt.id = any (pass)
    returning nt.id, (select u.telegram_id from users u where u.id = nt.user_id), nt.text, nt.buttons;
end $$;
revoke execute on function claim_notifications(int) from public, anon, authenticated;
grant execute on function claim_notifications(int) to service_role;

-- 6. Журнал рассылок: подавленные по согласию считаются отдельно; pending + sent + failed + skipped + cleared = recipients
drop function camp_broadcast_list(uuid);
create function camp_broadcast_list(cid uuid)
returns table (id uuid, kind text, body text, recipients int, author_name text, created_at timestamptz, pending int, sent int, failed int, skipped int, cleared int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform camp_assert_admin();
  return query
    select b.id, b.kind, b.body, b.recipients, b.author_name, b.created_at,
           count(n.id) filter (where n.state = 'pending')::int,
           count(n.id) filter (where n.state = 'sent')::int,
           count(n.id) filter (where n.state = 'failed')::int,
           count(n.id) filter (where n.state = 'skipped')::int,
           (b.recipients - count(n.id))::int
      from camp_broadcasts b
      left join camp_broadcast_messages m on m.broadcast_id = b.id
      left join notifications n on n.id = m.notification_id
     where b.camp_id = cid
     group by b.id
     order by b.created_at desc;
end $$;

revoke execute on function enqueue_notification(uuid, text, text, uuid[]), enqueue_direction_notification(uuid, text, text, text, uuid[]),
  camp_broadcast_player_ids(uuid, uuid), camp_broadcast_list(uuid) from public, anon, authenticated, service_role;
grant execute on function camp_broadcast_list(uuid) to authenticated;

commit;
