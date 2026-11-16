-- ОТКАТ 0198: возвращает поиск ребёнка с телом из 0173 (вся строка как кусок имени) и удаляет link_search_norm.
-- Откатите вместе с веб-приложением (подсказка про латиницу безвредна). Сначала db/ops/preflight.sql.
begin;
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
      and not exists (select 1 from player_guardians pg where pg.player_id = p.id and pg.user_id = current_user_id()
                       and (consent_new_model_for(pg.user_id, pg.player_id) or parent_access_ok(pg.user_id, pg.player_id)))
      and not exists (select 1 from link_requests r where r.player_id = p.id and r.user_id = current_user_id())
    order by p.full_name
    limit 5;
end $function$;

drop function if exists link_search_norm(text);
commit;
