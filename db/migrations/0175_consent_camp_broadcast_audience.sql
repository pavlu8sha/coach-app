-- 0175 (#238, дельта к 0173): получатели рассылок по сборам по условию доступа parent_access_ok.
-- Почему отдельная миграция: 0172 (#603, интерфейс рассылок) слита в master почти одновременно с 0173 и переписала
-- camp_broadcast_targets (теперь это выборка из camp_broadcast_audience), а 0173 собиралась до 0172 и вернула прежнее тело
-- camp_broadcast_targets; новая camp_broadcast_audience осталась со старым условием доступа по полю связи.
-- 0173 уже применена, поэтому исправление идёт следующей миграцией, а не правкой 0173.
-- Что делает: camp_broadcast_audience из 0172 с условием parent_access_ok (два места: info и reminder);
-- camp_broadcast_targets как в 0172 (один источник для предпросмотра и отправки). camp_broadcast_unreachable не меняется.
-- Требует 0172 и 0173 (иначе 0172, применённая позже, вернёт старое условие). Состав получателей при режиме off прежний.

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
               where parent_access_ok(g.user_id, g.player_id)) x
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

create or replace function camp_broadcast_targets(cid uuid, k text, b text) returns table (user_id uuid, msg text)
language sql stable security definer set search_path = public as $$
  select a.user_id, a.msg from camp_broadcast_audience(cid, k, b) a where a.status = 'ok' order by a.user_id
$$;

revoke execute on function camp_broadcast_audience(uuid, text, text), camp_broadcast_targets(uuid, text, text)
  from public, anon, authenticated, service_role;
