-- 0171 (Issue #470, интерфейс рассылок): предпросмотр показывает фактический список получателей и тех, до кого сообщение
-- не дойдёт (с причиной), а результат рассылки читается по каждому получателю.
-- Решение владельца (11.11.2026): если зарегистрированы оба родителя, сообщение получает каждый отдельно; один аккаунт
-- получает одно сообщение за рассылку, сколько бы детей с ним ни было связано; недоступного родителя другим членом семьи
-- не заменяем, а явно показываем в предпросмотре и результате.
-- Причины недоступности: notifications_off (родитель выключил уведомления бота), daily_limit (уже три сообщения рассылок
-- за сутки). Недоставленное после отправки (бот заблокирован) видно в результате (camp_broadcast_recipients).
-- Состав получателей и тексты прежние (0170): меняется только форма ответа и добавляется чтение результата.

-- Все родители и владельцы записей, которым рассылка адресована по правилам вида, с признаком доступности
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

-- Получатели: те, до кого сообщение дойдёт. Единственный источник и для предпросмотра, и для отправки.
create or replace function camp_broadcast_targets(cid uuid, k text, b text) returns table (user_id uuid, msg text)
language sql stable security definer set search_path = public as $$
  select a.user_id, a.msg from camp_broadcast_audience(cid, k, b) a where a.status = 'ok' order by a.user_id
$$;

-- Предпросмотр: число сообщений, список получателей, недоступные с причиной, пример текста, метка состава.
-- Ничего не отправляет и в журнал не пишет.
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
  if s is null and k = 'info' then s := 'Сбор «' || left((select name from camps where id = cid), 200) || E'»:\n' || t; end if;
  return jsonb_build_object('recipients', n, 'messages', n, 'list', lst, 'blocked', blk, 'sample', s, 'token', tok,
                            'unreachable', case when k = 'reminder' then camp_broadcast_unreachable(cid) end,
                            'enabled', camp_notify_enabled((select club_id from camps where id = cid)));
end $$;

-- Результат рассылки по получателям: ждёт, отправлено, не доставлено (с причиной от Telegram) или очищено очередью (старше 30 дней)
create or replace function camp_broadcast_recipients(bid uuid)
returns table (name text, state text, error text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform camp_assert_admin();
  return query
    select camp_notify_name(u.display_name), coalesce(n.state, 'cleared'), left(n.last_error, 200)
      from camp_broadcast_messages m
      left join notifications n on n.id = m.notification_id
      left join users u on u.id = m.user_id
     where m.broadcast_id = bid
     order by 1, m.user_id;
end $$;

revoke execute on function camp_broadcast_audience(uuid, text, text), camp_broadcast_targets(uuid, text, text),
  camp_broadcast_preview(uuid, text, text), camp_broadcast_recipients(uuid) from public, anon, authenticated, service_role;
grant execute on function camp_broadcast_preview(uuid, text, text), camp_broadcast_recipients(uuid) to authenticated;
