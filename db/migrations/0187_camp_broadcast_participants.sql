-- 0187 (Issue #470, аудит 11.11 C-07): рассылка «записанным на сбор». Условия приёмки: docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md (69-71).
-- Было два вида: info (все родители активных игроков клуба, решение Q9) и reminder (семьи с долгом). Сообщение по конкретному
-- сбору уходило всему клубу. Добавлен вид participants: родители (parent_access_ok) записанных игроков сбора и владельцы
-- записанных гостевых записей. info и reminder не меняются.
-- Тела функций взяты из последних определений master: camp_broadcast_check (0170), camp_broadcast_audience (0175),
-- camp_broadcast_preview (0172), camp_broadcast_send (0176); правки только для нового вида.
-- Требует 0175 и 0176 (иначе их применение позже вернёт прежние тела). Ничего не отправляет, данные не меняет.
-- Откат: db/ops/rollback-0187-camp-broadcast-participants.sql.
begin;

alter table camp_broadcasts drop constraint if exists camp_broadcasts_kind_check;
alter table camp_broadcasts add constraint camp_broadcasts_kind_check check (kind in ('info', 'reminder', 'participants'));

create or replace function camp_broadcast_check(cid uuid, k text, b text) returns text
language plpgsql stable security definer set search_path = public as $$
declare t text := camp_broadcast_clean(b);
begin
  perform camp_assert_admin();
  if k is null or k not in ('info', 'reminder', 'participants') then raise exception 'bad kind' using errcode = '22023'; end if;
  if (k in ('info', 'participants') and t is null) or length(t) > 1000 then raise exception 'bad text' using errcode = '22023'; end if;
  perform 1 from camps where id = cid;
  if not found then raise exception 'camp not found' using errcode = 'P0002'; end if;
  return t;
end $$;

create or replace function camp_broadcast_audience(cid uuid, k text, b text) returns table (user_id uuid, name text, msg text, status text)
language plpgsql stable security definer set search_path = public as $$
declare c camps;
begin
  select * into c from camps where id = cid;
  if k in ('info', 'participants') then
    return query
      select x.uid, camp_notify_name(u.display_name), 'Сбор «' || left(c.name, 200) || E'»:\n' || b,
             case when not u.notifications_enabled then 'notifications_off'
                  when (select count(*) from notifications n where n.user_id = x.uid and n.kind like 'camp\_broadcast\_%' and n.created_at > now() - interval '1 day') >= 3 then 'daily_limit'
                  else 'ok' end
        from (select distinct g.user_id as uid
                from player_guardians g
                join players p on p.id = g.player_id and p.club_id = c.club_id and p.status = 'active'
               where k = 'info' and parent_access_ok(g.user_id, g.player_id)
              union
              -- participants: родители записанных игроков этого сбора и владельцы записанных гостевых записей
              select g.user_id
                from camp_participants cp join player_guardians g on g.player_id = cp.player_id
               where k = 'participants' and cp.camp_id = cid and cp.status = 'registered' and parent_access_ok(g.user_id, g.player_id)
              union
              select cp.owner_user_id
                from camp_participants cp
               where k = 'participants' and cp.camp_id = cid and cp.status = 'registered' and cp.owner_user_id is not null) x
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
        select g.user_id as uid, d.child, d.rest from debt d join player_guardians g on g.player_id = d.player_id and parent_access_ok(g.user_id, g.player_id) where d.rest > 0
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

-- Дети получателя, записанные на сбор (для проверки согласия при выдаче, 0176). Только гостевая запись: null.
create or replace function camp_broadcast_participant_ids(cid uuid, uid uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array_agg(distinct cp.player_id)
    from camp_participants cp
    join player_guardians g on g.player_id = cp.player_id and g.user_id = uid and parent_access_ok(g.user_id, g.player_id)
   where cp.camp_id = cid and cp.status = 'registered' and cp.player_id is not null
$$;

-- Записанные участники, до семьи которых рассылка participants не дойдёт (нет родителя с доступом и включёнными
-- уведомлениями, нет владельца гостевой записи, исчерпан лимит)
create or replace function camp_broadcast_unreachable_participants(cid uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from camp_participants cp
   where cp.camp_id = cid and cp.status = 'registered'
     and not exists (
       select 1 from camp_broadcast_audience(cid, 'participants', '') a
        where a.status = 'ok'
          and (a.user_id = cp.owner_user_id
               or a.user_id in (select g.user_id from player_guardians g where g.player_id = cp.player_id and parent_access_ok(g.user_id, g.player_id))))
$$;

create or replace function camp_broadcast_preview(cid uuid, k text, b text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t text := camp_broadcast_check(cid, k, b); n int; s text; tok text; lst jsonb; blk jsonb;
begin
  select count(*)::int, min(x.msg) filter (where x.rn = 1), md5(coalesce(string_agg(x.user_id::text || ':' || x.msg, '|' order by x.user_id), '')),
         coalesce(jsonb_agg(jsonb_build_object('name', x.name) order by x.name, x.user_id), '[]'::jsonb)
    into n, s, tok, lst
    from (select a.user_id, a.name, a.msg, row_number() over (order by a.name, a.user_id) as rn
            from camp_broadcast_audience(cid, k, t) a where a.status = 'ok') x;
  select coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'reason', a.status) order by a.name, a.user_id), '[]'::jsonb)
    into blk from camp_broadcast_audience(cid, k, t) a where a.status <> 'ok';
  if s is null and k in ('info', 'participants') then s := 'Сбор «' || left((select name from camps where id = cid), 200) || E'»:\n' || t; end if;
  return jsonb_build_object('recipients', n, 'messages', n, 'list', lst, 'blocked', blk, 'sample', s, 'token', tok,
                            'unreachable', case when k = 'reminder' then camp_broadcast_unreachable(cid)
                                                when k = 'participants' then camp_broadcast_unreachable_participants(cid) end,
                            'enabled', camp_notify_enabled((select club_id from camps where id = cid)));
end $$;

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
    values (r.user_id, 'camp_broadcast_' || k, r.msg,
            case when k = 'reminder' then camp_broadcast_player_ids(cid, r.user_id)
                 when k = 'participants' then camp_broadcast_participant_ids(cid, r.user_id) end) returning id into nid;
    insert into camp_broadcast_messages (broadcast_id, notification_id, user_id) values (bid, nid, r.user_id);
  end loop;
  return jsonb_build_object('id', bid, 'recipients', n);
end $function$;

revoke execute on function camp_broadcast_check(uuid, text, text), camp_broadcast_audience(uuid, text, text),
  camp_broadcast_participant_ids(uuid, uuid), camp_broadcast_unreachable_participants(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function camp_broadcast_preview(uuid, text, text), camp_broadcast_send(uuid, text, text, int, text) from public, anon, service_role;
grant execute on function camp_broadcast_preview(uuid, text, text), camp_broadcast_send(uuid, text, text, int, text) to authenticated;

commit;
