-- Read-only: что будет удалено при снятии ВСЕХ связей одного аккаунта с детьми (родительские связи, тест кабинета родителя).
-- Только select, ничего не меняет. Запускать в Supabase SQL Editor ДО скрипта remove-my-child-links-2026-11-05.sql.
-- Впиши Telegram id личного аккаунта вместо 0 (одно место, ниже).

with me as (select id, display_name, is_admin, chosen_role from users where telegram_id = 0 /* ← Telegram id личного аккаунта */)
select 'аккаунт' as что, count(*) as строк, string_agg(display_name || ' (admin=' || is_admin || ', роль=' || coalesce(chosen_role, '-') || ')', '; ') as детали from me
union all select 'группы тренера (НЕ трогаем)', count(*), string_agg(g.name, ', ') from coach_groups cg join me on me.id = cg.user_id join groups g on g.id = cg.group_id
union all select 'player_guardians (будут удалены)', count(*), string_agg(p.full_name, ', ') from player_guardians pg join me on me.id = pg.user_id join players p on p.id = pg.player_id
union all select 'link_requests (будут удалены)', count(*), string_agg(p.full_name || ':' || r.status, ', ') from link_requests r join me on me.id = r.user_id join players p on p.id = r.player_id
union all select 'link_notify_log (будут удалены)', count(*), null from link_notify_log l join me on me.id = l.user_id
union all select 'child_codes, созданные им (будут удалены)', count(*), string_agg(p.full_name, ', ') from child_codes c join me on me.id = c.created_by join players p on p.id = c.player_id
union all select 'data_requests (будут удалены)', count(*), string_agg(d.kind || ':' || d.status, ', ') from data_requests d join me on me.id = d.user_id
union all select 'rate_limits по связям (будут удалены)', count(*), string_agg(key, ', ') from rate_limits r join me on r.key like 'link%' and r.key like '%' || me.id::text
union all select 'child_links детей этих игроков (НЕ трогаем, только для сведения)', count(*), string_agg(p.full_name, ', ') from child_links cl join players p on p.id = cl.player_id where cl.player_id in (select pg.player_id from player_guardians pg join me on me.id = pg.user_id)
union all select 'игроки, где он единственный опекун (после удаления без родителя)', count(*), string_agg(p.full_name, ', ') from players p where exists (select 1 from player_guardians a join me on me.id = a.user_id where a.player_id = p.id) and not exists (select 1 from player_guardians b join me on true where b.player_id = p.id and b.user_id <> me.id)
union all select 'notifications в очереди (НЕ трогаем)', count(*), null from notifications n join me on me.id = n.user_id
union all select 'audit_log с его участием (НЕ трогаем, журнал)', count(*), null from audit_log a join me on me.id = a.actor_id;

-- Подробно: какие именно связи будут удалены
with me as (select id from users where telegram_id = 0 /* ← тот же Telegram id */)
select p.full_name as игрок, g.name as группа, pg.relation, pg.consent_given_at, pg.consent_revoked_at
from player_guardians pg join me on me.id = pg.user_id join players p on p.id = pg.player_id left join groups g on g.id = p.group_id
order by p.full_name;
